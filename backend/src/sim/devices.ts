import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { Contract, JsonRpcProvider, SigningKey, Wallet, randomBytes, toBigInt } from "ethers";
import WebSocket from "ws";
import {
  type DigestContext,
  type ChangeFields,
  ChangeKind,
  payDigest,
  PqKeyTree,
  pqSeedFromKey,
  encodePqSignature,
  PQ_DEFAULT_HEIGHT,
  reconfirmDigest,
  cancelDigest,
  vetoDigest,
  approveDigest,
  freezeDigest,
  alertAckDigest,
  changeDigest,
  changeApproveDigest,
  changeVetoDigest,
  decodeChangeData,
  ethSignedHash,
  formatAmount,
  tokenInfo,
} from "../shared.js";
import { config } from "../config.js";
import { VAULT_ABI } from "../chain/vault.js";

type Msg = { t: string } & Record<string, unknown>;

const BASE = `http://127.0.0.1:${config.port}`;
const WS_BASE = BASE.replace(/^http/, "ws");
const ctx: DigestContext = { chainId: config.chainId, vault: config.vault };
const CONTROL_PORT = Number(process.env.SIM_PORT ?? 8790);
let auto = process.argv.includes("--auto") || process.env.SIM_AUTO === "1";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}; run the local setup or set it in .env`);
  return v;
}

const puckKey = new SigningKey(need("SIM_PUCK_PRIVATE_KEY"));

// The simulated puck's hash-based (post-quantum) keys, derived like the firmware does. The next one-time key
// index is kept on disk so a restart never signs twice with the same key.
const PQ_HEIGHT = Number(process.env.PQ_HEIGHT ?? PQ_DEFAULT_HEIGHT);
let pqTree: InstanceType<typeof PqKeyTree> | null = null;
const pqStateFile = resolve(process.cwd(), ".hisn-sim-pq.json");
function pqSign(digest: string): { pq: string } | Record<string, never> {
  if (process.env.SIM_PQ === "0") return {};
  if (!pqTree) {
    pqTree = new PqKeyTree(pqSeedFromKey(puckKey.privateKey), PQ_HEIGHT);
    console.log(`sim puck: hash-based keys ready, root ${pqTree.root}`);
  }
  let state: Record<string, number> = {};
  try {
    state = JSON.parse(readFileSync(pqStateFile, "utf8")) as Record<string, number>;
  } catch {
    state = {};
  }
  const leaf = state[pqTree.root] ?? 0;
  if (leaf >= pqTree.capacity) {
    console.error("sim puck: no hash-based one-time keys left");
    return {};
  }
  state[pqTree.root] = leaf + 1;
  writeFileSync(pqStateFile, JSON.stringify(state));
  return { pq: encodePqSignature(pqTree.sign(ctx, digest, leaf)) };
}
const puckAddr = new Wallet(puckKey.privateKey).address;
const guardianKeys = (process.env.SIM_GUARDIAN_PRIVATE_KEYS ?? "").split(",").filter(Boolean).map((k) => new SigningKey(k));
const watcherKey = new SigningKey(need("SIM_WATCHER_PRIVATE_KEY"));
const watcherAddr = new Wallet(watcherKey.privateKey).address;

function signRS(key: SigningKey, digest: string): { r: string; s: string } {
  const sig = key.sign(ethSignedHash(digest));
  return { r: sig.r, s: sig.s };
}

function nonce(): bigint {
  return toBigInt(randomBytes(8));
}

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 120);
}

function fmt(amount: unknown, token: unknown): string {
  try {
    const t = tokenInfo(String(token), config.usdc);
    return `${formatAmount(BigInt(String(amount)), t.decimals)} ${t.symbol}`;
  } catch {
    return `${amount} (token ${token})`;
  }
}

function log(who: string, text: string): void {
  console.log(`${new Date().toLocaleTimeString()} [${who}] ${text}`);
}

class SimDevice {
  ws: WebSocket | null = null;
  handlers: ((m: Msg) => void)[] = [];

  constructor(readonly id: string, readonly role: "puck" | "guardian", readonly address: string) {}

  connect(): void {
    const ws = new WebSocket(`${WS_BASE}/device?id=${this.id}&role=${this.role}${config.apiToken ? `&token=${encodeURIComponent(config.apiToken)}` : ""}`);
    this.ws = ws;
    ws.on("open", () => {
      this.send({ t: "hello", address: this.address, fw: "sim-0.1" });
      log(this.id, "connected");
    });
    ws.on("message", (raw) => {
      let m: Msg;
      try {
        m = JSON.parse(String(raw)) as Msg;
      } catch {
        return;
      }
      if (m.t === "ping") {
        this.send({ t: "pong" });
        return;
      }
      for (const h of this.handlers) h(m);
    });
    ws.on("close", () => {
      log(this.id, "disconnected, retrying in 2 s");
      setTimeout(() => this.connect(), 2000);
    });
    ws.on("error", () => undefined);
  }

  send(m: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  }

  on(fn: (m: Msg) => void): void {
    this.handlers.push(fn);
  }
}

const puck = new SimDevice("sim-puck", "puck", puckAddr);
const light = new SimDevice("sim-light", "guardian", watcherAddr);

const requests = new Map<number, Msg>();
const reconfirms = new Map<number, Msg>();
const changes = new Map<number, Msg>();
let epoch = 0;

function describeChange(m: Msg): string {
  return `${m.kindName} ${JSON.stringify(m.fields)}`;
}

function puckSign(reqId: number): string {
  const r = requests.get(reqId);
  if (!r) return `no request ${reqId}`;
  const f = { to: String(r.to), token: String(r.token), amount: BigInt(String(r.amount)), nonce: nonce(), deadline: deadline() };
  puck.send({ t: "signed", reqId, nonce: "0x" + f.nonce.toString(16), deadline: Number(f.deadline), ...signRS(puckKey, payDigest(ctx, f)), ...pqSign(payDigest(ctx, f)) });
  requests.delete(reqId);
  return `signed request ${reqId}`;
}

function puckReject(reqId: number): string {
  if (requests.delete(reqId)) {
    puck.send({ t: "rejected", reqId });
    return `rejected request ${reqId}`;
  }
  if (changes.delete(reqId)) {
    puck.send({ t: "rejected", reqId, change: true });
    return `rejected change request ${reqId}`;
  }
  return `no request ${reqId}`;
}

function puckReconfirm(paymentId: number): string {
  const n = nonce();
  const d = deadline();
  const rd = reconfirmDigest(ctx, BigInt(paymentId), n, d);
  puck.send({ t: "reconfirmed", paymentId, nonce: "0x" + n.toString(16), deadline: Number(d), ...signRS(puckKey, rd), ...pqSign(rd) });
  reconfirms.delete(paymentId);
  return `reconfirmed payment ${paymentId}`;
}

function puckCancel(paymentId: number): string {
  puck.send({ t: "cancel", paymentId, ...signRS(puckKey, cancelDigest(ctx, BigInt(paymentId))) });
  reconfirms.delete(paymentId);
  return `cancel sent for payment ${paymentId}`;
}

function puckSignChange(reqId: number): string {
  const c = changes.get(reqId);
  if (!c) return `no change request ${reqId}`;
  const kind = Number(c.kind) as ChangeKind;
  const fields: ChangeFields = decodeChangeData(kind, String(c.data));
  const n = nonce();
  const d = deadline();
  const cd = changeDigest(ctx, fields, BigInt(Number(c.keyEpoch)), n, d);
  puck.send({ t: "change_signed", reqId, nonce: "0x" + n.toString(16), deadline: Number(d), ...signRS(puckKey, cd), ...pqSign(cd) });
  changes.delete(reqId);
  return `signed change request ${reqId}`;
}

function lightVeto(paymentId: number): string {
  light.send({ t: "veto", paymentId, ...signRS(watcherKey, vetoDigest(ctx, BigInt(paymentId))) });
  return `light veto sent for payment ${paymentId}`;
}

function freeze(who: string): string {
  const key = who === "puck" ? puckKey : who === "guardian" ? guardianKeys[0] : watcherKey;
  const dev = who === "puck" ? puck : light;
  if (!key) return "no key";
  dev.send({ t: "freeze", epoch, ...signRS(key, freezeDigest(ctx, BigInt(epoch))) });
  return `freeze sent by ${who} for epoch ${epoch}`;
}

async function post(path: string, body: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiToken}` },
    body: JSON.stringify(body),
  });
  const out = (await r.json()) as { tx?: string; error?: string };
  return r.ok ? `ok ${out.tx ?? ""}` : `error ${out.error}`;
}

async function guardianStop(paymentId: number, who: string): Promise<string> {
  if (who === "watcher") return lightVeto(paymentId);
  const key = guardianKeys[0];
  if (!key) return "no guardian key";
  return post("/relay/veto", { paymentId, ...signRS(key, vetoDigest(ctx, BigInt(paymentId))) });
}

async function guardianApprove(paymentId: number): Promise<string> {
  const key = guardianKeys[0];
  if (!key) return "no guardian key";
  return post("/relay/approve", { paymentId, ...signRS(key, approveDigest(ctx, BigInt(paymentId))) });
}

async function changeApprove(changeId: number): Promise<string> {
  const key = guardianKeys[0];
  if (!key) return "no guardian key";
  const r = await fetch(`${BASE}/changes`, { headers: { authorization: `Bearer ${config.apiToken}` } });
  const list = (await r.json()) as { id: number; kind: string }[];
  if (!list.some((c) => c.id === changeId)) return `no change ${changeId}`;
  const data = await changeData(changeId);
  if (!data) return `cannot read change ${changeId}`;
  return post(`/relay/change/${changeId}/approve`, signRS(key, changeApproveDigest(ctx, BigInt(changeId), data.kind, data.data)));
}

async function changeData(changeId: number): Promise<{ kind: ChangeKind; data: string } | null> {
  const v = new Contract(config.vault, VAULT_ABI, new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true }));
  const c = await v.getChange(changeId);
  return { kind: Number(c.kind) as ChangeKind, data: String(c.data) };
}

async function changeVeto(changeId: number, who: string): Promise<string> {
  if (who === "puck") {
    puck.send({ t: "change_veto", changeId, ...signRS(puckKey, changeVetoDigest(ctx, BigInt(changeId))) });
    return `puck change veto sent for ${changeId}`;
  }
  light.send({ t: "change_veto", changeId, ...signRS(watcherKey, changeVetoDigest(ctx, BigInt(changeId))) });
  return `light change veto sent for ${changeId}`;
}

puck.on((m) => {
  switch (m.t) {
    case "request":
      requests.set(Number(m.reqId), m);
      log("puck", `REVIEW request ${m.reqId}: send ${fmt(m.amount, m.token)} to ${m.to}${auto ? " (auto-sign)" : `  -> 'y ${m.reqId}' or 'n ${m.reqId}'`}`);
      if (auto) setTimeout(() => log("puck", puckSign(Number(m.reqId))), 800);
      return;
    case "result":
      log("puck", m.ok ? `ok ${m.what ?? "payment"} ${m.paymentId ?? m.changeId ?? ""} ${m.tier ?? ""}${m.releaseAt ? ` releases at ${new Date(Number(m.releaseAt) * 1000).toLocaleTimeString()}` : ""}` : `FAILED: ${m.error}`);
      return;
    case "reconfirm":
      reconfirms.set(Number(m.paymentId), m);
      log("puck", `STILL SEND? payment ${m.paymentId}: ${fmt(m.amount, m.token)} to ${m.to}${auto ? " (auto-yes)" : `  -> 'r ${m.paymentId}' yes, 'c ${m.paymentId}' cancel`}`);
      if (auto) setTimeout(() => log("puck", puckReconfirm(Number(m.paymentId))), 800);
      return;
    case "change":
      changes.set(Number(m.reqId), m);
      log("puck", `CHANGE REVIEW ${m.reqId}: ${describeChange(m)}${auto ? " (auto-sign)" : `  -> 'cs ${m.reqId}' sign, 'n ${m.reqId}' no`}`);
      if (auto) setTimeout(() => log("puck", puckSignChange(Number(m.reqId))), 800);
      return;
    case "cancel_request":
      // The owner pressed Stop on the web page; the simulated puck signs CANCEL (same path as 'c <pay>').
      log("puck", `STOP REQUEST from the web page for payment ${m.paymentId}`);
      setTimeout(() => log("puck", puckCancel(Number(m.paymentId))), 300);
      return;
    case "freeze_request":
      log("puck", "FREEZE REQUEST from the web page");
      setTimeout(() => log("puck", freeze("puck")), 300);
      return;
    case "stopped":
      log("puck", `payment ${m.paymentId} ended: ${m.why}${m.why === "VETOED" ? "  STOPPED BY GUARDIAN / NOBODY CAN RECOVER MONEY FOR A FEE" : ""}`);
      return;
    case "recovery_alert":
      log("puck", `SOMEONE IS REPLACING THIS PUCK (change ${m.changeId})  -> 'pv ${m.changeId}' to cancel`);
      return;
    case "change_applied":
      log("puck", `change ${m.changeId} applied: ${m.kindName} ${JSON.stringify(m.fields)}`);
      return;
    case "state":
      epoch = Number(m.epoch ?? epoch);
      return;
    case "error":
      log("puck", `relayer error on ${m.for}: ${m.reason}`);
      return;
    default:
      return;
  }
});

const ackNonce = new Map<number, bigint>();
light.on((m) => {
  switch (m.t) {
    case "alert": {
      const id = Number(m.paymentId);
      log("light", `ALARM payment ${id}: ${m.tier} ${fmt(m.amount, m.token)} to ${m.to}, releases ${new Date(Number(m.releaseAt) * 1000).toLocaleTimeString()}  -> 'v ${id}' to stop`);
      const n = ackNonce.get(id) ?? nonce();
      ackNonce.set(id, n);
      light.send({ t: "ack", paymentId: id, nonce: "0x" + n.toString(16), ...signRS(watcherKey, alertAckDigest(ctx, BigInt(id), n)) });
      return;
    }
    case "clear":
      log("light", `calm: payment ${m.paymentId} ${m.why}`);
      return;
    case "change_alert":
      log("light", `ALARM settings change ${m.changeId} (kind ${m.kind})  -> 'lv ${m.changeId}' to stop`);
      return;
    case "change_clear":
      log("light", `calm: change ${m.changeId} ${m.why}`);
      return;
    case "result":
      log("light", m.ok ? `ok ${m.what} ${m.tx ?? ""}` : `FAILED ${m.error}`);
      return;
    case "state":
      epoch = Number(m.epoch ?? epoch);
      return;
    case "error":
      log("light", `relayer error on ${m.for}: ${m.reason}`);
      return;
    default:
      return;
  }
});

async function run(cmd: string): Promise<string> {
  const [op, a, b] = cmd.trim().split(/\s+/);
  const n = Number(a);
  switch (op) {
    case "y":
      return puckSign(n);
    case "n":
      return puckReject(n);
    case "r":
      return puckReconfirm(n);
    case "c":
      return puckCancel(n);
    case "cs":
      return puckSignChange(n);
    case "pv":
      return changeVeto(n, "puck");
    case "v":
      return lightVeto(n);
    case "gv":
      return guardianStop(n, "guardian");
    case "a":
      return guardianApprove(n);
    case "ca":
      return changeApprove(n);
    case "lv":
      return changeVeto(n, "light");
    case "f":
      return freeze(a ?? "watcher");
    case "auto":
      auto = a !== "off";
      return `auto ${auto ? "on" : "off"}`;
    case "":
    case undefined:
      return "";
    default:
      return HELP;
  }
}

const HELP = [
  "puck:  y <req> sign | n <req> no | r <pay> still send | c <pay> cancel | cs <req> sign change | pv <change> stop recovery",
  "light: v <pay> stop | lv <change> stop change | f [puck|guardian|watcher] freeze",
  "phone: gv <pay> stop | a <pay> approve | ca <change> approve change",
  "auto on|off   (auto-sign every request and second confirmation)",
].join("\n");

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  const map: Record<string, string> = {
    "puck/sign": "y",
    "puck/reject": "n",
    "puck/reconfirm": "r",
    "puck/cancel": "c",
    "puck/change": "cs",
    "guardian/stop": url.searchParams.get("who") === "watcher" ? "v" : "gv",
    "guardian/approve": "a",
    "change/approve": "ca",
    "change/veto": "lv",
  };
  let out: string;
  if (parts[0] === "freeze") out = await run(`f ${url.searchParams.get("who") ?? "watcher"}`);
  else if (parts[0] === "auto") out = await run(`auto ${url.searchParams.get("on") === "0" ? "off" : "on"}`);
  else if (parts[0] === "status") out = JSON.stringify({ auto, requests: [...requests.keys()], reconfirms: [...reconfirms.keys()], changes: [...changes.keys()] });
  else {
    const op = map[`${parts[0]}/${parts[1]}`];
    out = op ? await run(`${op} ${parts[2] ?? ""}`) : "unknown";
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ result: out }));
}).listen(CONTROL_PORT, "127.0.0.1");

if (process.env.SIM_ONLY !== "light") puck.connect();
if (process.env.SIM_ONLY !== "puck") light.connect();
console.log(`device simulator: puck ${puckAddr}, light ${watcherAddr}, control http://127.0.0.1:${CONTROL_PORT}`);
console.log(HELP);
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const out = await run(line);
  if (out) console.log(out);
});
