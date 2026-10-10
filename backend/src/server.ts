import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";
import { formatEther, getAddress, isAddress } from "ethers";
import type { LiveEvent, TimelineEntry } from "./shared.js";
import { hashscanContract, hashscanTopic, hashscanTx } from "./shared.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { VaultClient } from "./chain/vault.js";
import type { Indexer } from "./indexer.js";
import type { HcsLog } from "./hcs.js";
import type { DeviceHub, DeviceRole } from "./devices.js";
import { Flows, HttpError } from "./flows.js";
import type { AgentModule } from "./agent-host.js";

export interface App {
  cfg: Config;
  db: Db;
  vault: VaultClient;
  idx: Indexer;
  hcs: HcsLog;
  hub: DeviceHub;
  flows: Flows;
  agent: () => AgentModule | null;
}

// /live checks the token itself; /device goes through the hook (Bearer or ?token=) and checks again in its handler.
const OPEN_ROUTES = new Set(["/health", "/live", "/api/v1/contracts/call"]);

function tokenOk(cfg: Config, given: string | undefined): boolean {
  if (!cfg.apiToken) return true;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(cfg.apiToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  const q = (req.query as Record<string, string> | undefined)?.token;
  return q;
}

function byTime(a: TimelineEntry, b: TimelineEntry): number {
  const ta = Number(a.consensusTimestamp ?? a.at);
  const tb = Number(b.consensusTimestamp ?? b.at);
  return ta - tb;
}

function num(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "bad id");
  return n;
}

export async function buildServer(app: App): Promise<FastifyInstance> {
  const { cfg, idx, flows, hub, hcs, vault } = app;
  const f = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  await f.register(cors, {
    origin: (origin, cb) => cb(null, !origin || cfg.corsOrigins.includes("*") || cfg.corsOrigins.includes(origin)),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
  });
  await f.register(websocket, { options: { maxPayload: 16 * 1024 } });

  f.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    const remote = typeof req.headers["cf-connecting-ip"] === "string";
    if (req.method === "OPTIONS" || (OPEN_ROUTES.has(path) && !(remote && path === "/device"))) return;
    if (path.startsWith("/relay/") && req.method === "POST") return;
    if (!tokenOk(cfg, bearer(req))) {
      reply.code(401).send({ error: "missing or wrong API token" });
    }
  });

  f.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status === 500) console.error(err);
    return reply.code(status).send({ error: err.message });
  });

  const live = new Set<WebSocket>();
  const broadcast = (e: LiveEvent) => {
    const s = JSON.stringify(e);
    for (const ws of live) if (ws.readyState === 1) ws.send(s);
  };
  idx.on("payment", (p) => broadcast({ kind: "payment", data: p }));
  idx.on("change", (c) => broadcast({ kind: "change", data: c }));
  idx.on("state", (s) => broadcast({ kind: "state", data: s }));
  idx.on("event", (e) => broadcast({ kind: "hcs", data: idx.eventEntry(e) }));
  hub.on("device", (d) => broadcast({ kind: "device", data: d }));
  hcs.onEntry((e) => broadcast({ kind: "hcs", data: e }));
  flows.on("request", (r) => broadcast({ kind: "request", data: r }));

  f.get("/live", { websocket: true }, (socket, req) => {
    if (!tokenOk(cfg, bearer(req))) {
      socket.close(4401, "unauthorized");
      return;
    }
    live.add(socket);
    socket.on("close", () => live.delete(socket));
    socket.on("error", () => live.delete(socket));
    const s = idx.state;
    if (s) socket.send(JSON.stringify({ kind: "state", data: s } satisfies LiveEvent));
  });

  f.get("/device", { websocket: true }, (socket, req) => {
    if (!tokenOk(cfg, bearer(req))) {
      socket.close(4401, "unauthorized");
      return;
    }
    const q = req.query as { id?: string; role?: string; token?: string };
    const role: DeviceRole = q.role === "puck" ? "puck" : "guardian";
    const id = (q.id ?? `${role}-${Date.now()}`).slice(0, 64);
    hub.attach(socket, id, role);
  });

  f.get("/health", async () => {
    const [bal, rpcOk, mirrorOk] = await Promise.all([
      vault.provider.getBalance(vault.address).catch(() => null),
      vault.provider.getBlockNumber().then(() => true, () => false),
      cfg.mode === "local"
        ? Promise.resolve(true)
        : fetch(`${cfg.mirrorUrl}/api/v1/network/supply`).then((r) => r.ok, () => false),
    ]);
    return {
      ok: rpcOk && mirrorOk && !idx.lastError,
      mode: cfg.mode,
      vault: cfg.vault,
      relayer: vault.address,
      relayerBalance: bal === null ? null : formatEther(bal),
      rpc: rpcOk,
      mirror: mirrorOk,
      hcs: hcs.enabled,
      topicId: cfg.topicId,
      lastEventAt: idx.lastEventAt,
      lastPollOk: Math.floor(idx.lastPollOk / 1000),
      lastError: idx.lastError,
      devices: hub.list(),
      agent: !!app.agent(),
      links: {
        vault: hashscanContract(cfg.vault),
        topic: cfg.topicId ? hashscanTopic(cfg.topicId) : null,
      },
    };
  });

  f.get("/state", async () => {
    const s = idx.state ?? (await idx.refreshState(true));
    if (!s) throw new HttpError(503, "state not loaded yet");
    return s;
  });

  f.get("/payments", async () => [...idx.payments.values()].sort((a, b) => b.id - a.id));

  f.get("/payments/:id", async (req) => {
    const id = num((req.params as { id: string }).id);
    return idx.payments.get(id) ?? (await idx.refreshPayment(id));
  });

  f.get("/payments/:id/timeline", async (req) => {
    const id = num((req.params as { id: string }).id);
    const p = idx.payments.get(id);
    const events = idx.eventsForPayment(id);
    const msgs = hcs.forPayment(id);
    const reqMsgs: TimelineEntry[] = [];
    if (p) {
      const r = app.db.listRequests(cfg.vault, 200).find((x) => x.paymentId === id);
      if (r) {
        for (const e of hcs.all(500)) {
          const body = e.hcs?.body as Record<string, unknown> | undefined;
          if ((e.name === "REQUEST" || e.name === "PAY_SIGNED") && body && Number(body.reqId) === r.reqId) reqMsgs.push(e);
        }
      }
    }
    return [...reqMsgs, ...events, ...msgs].sort(byTime);
  });

  f.get("/changes", async () => [...idx.changes.values()].sort((a, b) => b.id - a.id));

  f.get("/changes/:id/timeline", async (req) => {
    const id = num((req.params as { id: string }).id);
    return [...idx.eventsForChange(id), ...hcs.forChange(id)].sort(byTime);
  });

  f.get("/log", async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 200), 1), 1000);
    const events = idx.events.slice(-limit).map((e) => idx.eventEntry(e));
    const msgs = hcs.all(limit);
    return [...events, ...msgs].sort((a, b) => byTime(b, a)).slice(0, limit);
  });

  f.get("/requests", async () => app.db.listRequests(cfg.vault, 50));

  f.post("/requests", async (req) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const r = await flows.createRequest({ to: b.to, token: b.token, amount: b.amount, source: (b.source as "dashboard" | "agent") ?? "dashboard", note: b.note });
    return { reqId: r.reqId, tier: r.tier };
  });

  f.get("/requests/:reqId", async (req) => flows.getRequest(num((req.params as { reqId: string }).reqId)));

  const preview = async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, string>;
    let amount: bigint;
    try {
      amount = BigInt(b.amount);
    } catch {
      throw new HttpError(400, "bad amount");
    }
    return flows.preview(b.to, b.token, amount);
  };
  f.post("/tier", preview);
  f.post("/preview", preview);

  f.post("/payments/:id/stop-request", async (req) => flows.requestStop(num((req.params as { id: string }).id)));
  f.post("/freeze-request", async () => flows.requestFreeze());

  f.post("/changes/request", async (req) => {
    const b = (req.body ?? {}) as { kind?: string; fields?: Record<string, unknown> };
    return flows.requestChange(String(b.kind ?? ""), b.fields ?? {});
  });

  f.get("/changes/request/:reqId", async (req) => flows.getChangeRequest(num((req.params as { reqId: string }).reqId)));

  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, string> & { paymentId: string; epoch: string; kind: string; data: string; nonce: string; deadline: string; r?: string; s?: string; sig?: string };
  f.post("/relay/veto", async (req) => ({ tx: await flows.veto(body(req)) }));
  f.post("/relay/approve", async (req) => ({ tx: await flows.approve(body(req)) }));
  f.post("/relay/freeze", async (req) => ({ tx: await flows.freeze(body(req)) }));
  f.post("/relay/renew-freeze", async (req) => ({ tx: await flows.renewFreeze(body(req)) }));
  f.post("/relay/reconfirm", async (req) => {
    const b = body(req);
    return { tx: await flows.reconfirm({ paymentId: b.paymentId, nonce: b.nonce, deadline: b.deadline, r: b.r, s: b.s, sig: b.sig }) };
  });
  f.post("/relay/cancel", async (req) => ({ tx: await flows.cancel(body(req)) }));
  f.post("/relay/change", async (req) => flows.proposeChange(body(req)));
  f.post("/relay/change/:id/approve", async (req) => ({ tx: await flows.approveChange(num((req.params as { id: string }).id), body(req)) }));
  f.post("/relay/change/:id/veto", async (req) => ({ tx: await flows.vetoChange(num((req.params as { id: string }).id), body(req)) }));

  f.post("/relay/change/:id/execute", async (req, reply: FastifyReply) => {
    if (!tokenOk(cfg, bearer(req))) return reply.code(401).send({ error: "missing or wrong API token" });
    return { tx: await flows.executeChange(num((req.params as { id: string }).id)) };
  });

  f.post("/fallback/execute/:id", async (req) => ({ tx: await flows.fallbackExecute(num((req.params as { id: string }).id)) }));

  f.post("/agent/chat", async (req) => {
    const agent = app.agent();
    if (!agent) throw new HttpError(503, "the helper agent is not installed on this server");
    const msg = String((req.body as { message?: string } | undefined)?.message ?? "").slice(0, 2000);
    if (!msg.trim()) throw new HttpError(400, "empty message");
    return agent.chat(msg);
  });

  f.get("/agent/history", async () => app.agent()?.history?.() ?? []);

  f.get("/export/:id", async (req) => {
    const id = num((req.params as { id: string }).id);
    const p = idx.payments.get(id) ?? (await idx.refreshPayment(id));
    const events = idx.eventsForPayment(id);
    const msgs = hcs.forPayment(id);
    return {
      format: "hisn-evidence-v1",
      exportedAt: new Date().toISOString(),
      network: cfg.mode === "testnet" ? "hedera-testnet" : "local",
      chainId: cfg.chainId,
      vault: cfg.vault,
      vaultLink: hashscanContract(cfg.vault),
      topicId: cfg.topicId,
      topicLink: cfg.topicId ? hashscanTopic(cfg.topicId) : null,
      payment: p,
      contractEvents: idx.events
        .filter((e) => Number(e.args.id) === id && events.some((x) => x.tx === e.txHash))
        .map((e) => ({ ...e, link: hashscanTx(e.txHash) })),
      hcsMessages: msgs.map((m) => ({ consensusTimestamp: m.consensusTimestamp, verified: m.verified, signer: m.signer, message: m.hcs })),
      howToCheck: [
        "Each contract event links to HashScan; its caller field shows who released the money.",
        "For each signed HCS message, rebuild the digest from body with @hisn/shared and recover the signer; it must be the puck or a guardian of the vault.",
        "Order is the HCS consensus timestamp, not the 'at' field.",
      ],
    };
  });

  f.post("/labels", async (req) => {
    const b = body(req);
    if (!isAddress(b.address)) throw new HttpError(400, "bad address");
    app.db.setLabel(getAddress(b.address), String(b.label ?? "").slice(0, 32));
    await idx.refreshState(true);
    return { ok: true };
  });

  if (cfg.mode === "local") {
    f.post("/api/v1/contracts/call", async (req) => {
      const b = (req.body ?? {}) as { to?: string; data?: string; from?: string };
      const result = await vault.provider.call({ to: b.to, data: b.data, from: b.from });
      return { result };
    });
  }

  return f;
}
