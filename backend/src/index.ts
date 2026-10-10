import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Wallet } from "ethers";
import { config } from "./config.js";
import { Db } from "./db.js";
import { VaultClient } from "./chain/vault.js";
import { MirrorEventSource, RpcEventSource } from "./chain/events.js";
import { Indexer } from "./indexer.js";
import { HcsLog } from "./hcs.js";
import { DeviceHub } from "./devices.js";
import { Flows } from "./flows.js";
import { buildServer } from "./server.js";
import type { AgentHost, AgentModule, CreateAgent } from "./agent-host.js";

const here = dirname(fileURLToPath(import.meta.url));

async function loadAgent(host: AgentHost): Promise<AgentModule | null> {
  for (const name of ["agent/index.ts", "agent/index.js"]) {
    const p = resolve(here, name);
    if (!existsSync(p)) continue;
    try {
      const mod = (await import(pathToFileURL(p).href)) as { createAgent?: CreateAgent; default?: CreateAgent };
      const make = mod.createAgent ?? mod.default;
      if (typeof make !== "function") {
        console.error("agent module has no createAgent export");
        return null;
      }
      return await make(host);
    } catch (e) {
      console.error("agent module failed to load:", (e as Error).message);
      return null;
    }
  }
  return null;
}

async function main() {
  const db = new Db(config.dbPath);
  const vault = new VaultClient(config);
  const source = config.mode === "local" ? new RpcEventSource(vault.provider, config.vault) : new MirrorEventSource(config.mirrorUrl, config.vault);
  let hub: DeviceHub;
  const idx = new Indexer(config, db, vault, source, () => hub.list());
  hub = new DeviceHub(() => idx.roles.watchers);
  const hcs = new HcsLog(config, db, () => idx.roles, (h) => idx.knownTx(h));
  const flows = new Flows(config, db, vault, idx, hcs, hub);

  let agent: AgentModule | null = null;
  const server = await buildServer({ cfg: config, db, vault, idx, hcs, hub, flows, agent: () => agent });

  await idx.start();
  const hcsTimer = setInterval(() => void hcs.poll().catch((e) => console.error("hcs poll:", (e as Error).message)), 3000);
  void hcs.poll().catch(() => undefined);

  const host: AgentHost = {
    config,
    vault,
    agentWallet: config.agentKey ? new Wallet(config.agentKey, vault.provider) : null,
    state: () => idx.state,
    payments: () => [...idx.payments.values()],
    label: (a) => idx.label(a),
    requestPayment: (input) => flows.createRequest({ ...input, source: "agent" }),
    getRequest: (reqId) => flows.getRequest(reqId),
    refused: (info) => flows.agentRefused(info),
    refresh: async () => {
      await idx.tick();
      await idx.refreshState(true);
    },
    indexer: idx,
  };
  agent = await loadAgent(host);

  await server.listen({ port: config.port, host: config.host });
  const s = idx.state;
  console.log(`hisn relayer (${config.mode}) on :${config.port}`);
  console.log(`  vault   ${config.vault}${config.vaultId ? ` (${config.vaultId})` : ""}`);
  console.log(`  relayer ${vault.address}`);
  console.log(`  topic   ${config.topicId ?? "none"}${hcs.enabled ? "" : " (HCS posting off)"}`);
  console.log(`  puck    ${s?.puck}`);
  console.log(`  agent   ${agent ? "loaded" : "not installed"}`);
  console.log(`  events  ${idx.events.length}, payments ${idx.payments.size}, changes ${idx.changes.size}`);

  const shutdown = async () => {
    clearInterval(hcsTimer);
    idx.stop();
    hub.close();
    hcs.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

process.on("unhandledRejection", (e) => console.error("unhandled:", (e as Error)?.message ?? e));
process.on("uncaughtException", (e) => console.error("uncaught:", e.message));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
