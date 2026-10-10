import { getAddress } from "ethers";
import { config } from "../src/config.js";
import type { PaymentView, RequestView, StateView, DeviceView } from "../src/shared.js";

const API = process.env.CHECK_URL ?? `http://127.0.0.1:${config.port}`;
const MIN_USDC = BigInt(process.env.CHECK_MIN_USDC ?? "300") * 1_000_000n;
const MIN_RELAYER_HBAR = Number(process.env.CHECK_MIN_RELAYER_HBAR ?? "50");
let fails = 0;
let warns = 0;

function line(level: "PASS" | "WARN" | "FAIL", what: string, detail = "") {
  if (level === "FAIL") fails++;
  if (level === "WARN") warns++;
  console.log(`${level.padEnd(4)}  ${what}${detail ? `: ${detail}` : ""}`);
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${config.apiToken}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()) as T;
}

const usdc = (raw: string | bigint) => `${(Number(BigInt(raw)) / 1e6).toFixed(2)} USDC`;
const hbar = (tiny: string | bigint) => `${(Number(BigInt(tiny)) / 1e8).toFixed(2)} HBAR`;

async function main() {
  console.log(`checking ${API} (${config.mode}), vault ${config.vault}\n`);
  let health: any;
  try {
    health = await api<any>("/health");
  } catch (e) {
    line("FAIL", "relayer is running", `${(e as Error).message}. Start it: npm run relayer`);
    return;
  }
  line(health.ok ? "PASS" : "FAIL", "relayer, RPC and mirror node", health.ok ? "all reachable" : `rpc ${health.rpc}, mirror ${health.mirror}, last error ${health.lastError ?? "none"}`);
  line(getAddress(health.vault) === config.vault ? "PASS" : "FAIL", "relayer serves the vault in .env", health.vault);
  const relayerHbar = Number(health.relayerBalance ?? 0);
  line(relayerHbar >= MIN_RELAYER_HBAR ? "PASS" : relayerHbar >= 10 ? "WARN" : "FAIL", "relayer account can pay fees", `${relayerHbar.toFixed(1)} HBAR`);

  const s = await api<StateView>("/state");
  const now = Math.floor(Date.now() / 1000);
  line(!s.frozen ? "PASS" : "FAIL", "vault is not frozen", s.frozen ? `frozen for ${s.frozenUntil - now} s more` : "");
  line(BigInt(s.balances.usdc) >= MIN_USDC ? "PASS" : "FAIL", "vault holds enough USDC", usdc(s.balances.usdc));
  const spare = BigInt(s.balances.hbar) - BigInt(s.gasReserve);
  line(spare >= 0n ? "PASS" : "FAIL", "vault HBAR covers the release gas reserve", `${hbar(s.balances.hbar)}, reserve ${hbar(s.gasReserve)}`);
  line(s.payees.length > 0 ? "PASS" : "WARN", "saved payees", s.payees.map((p) => p.label ?? p.address).join(", ") || "none");
  line(s.coolOff <= 120 ? "PASS" : "WARN", "cool-off suits a live demo", `${s.coolOff} s`);

  const devices = (health.devices ?? s.devices ?? []) as DeviceView[];
  const puck = devices.find((d) => d.role === "puck" && d.online);
  line(puck ? "PASS" : "FAIL", "puck online", puck ? `${puck.id} ${puck.address}` : "not connected");
  if (puck) line(getAddress(puck.address) === getAddress(s.puck) ? "PASS" : "FAIL", "puck key matches the vault", s.puck);
  const watcherAddrs = s.watchers.map((w) => w.toLowerCase());
  const light = devices.find((d) => d.online && watcherAddrs.includes(d.address.toLowerCase()));
  line(light ? "PASS" : "FAIL", "guardian light online with a watcher key", light ? `${light.id} ${light.address}` : "no connected device holds a watcher key");
  const simulated = devices.filter((d) => d.online && d.id.startsWith("sim-"));
  if (simulated.length) line("WARN", "simulated devices connected", simulated.map((d) => d.id).join(", "));

  const pays = await api<PaymentView[]>("/payments");
  const pending = pays.filter((p) => p.status === "PENDING");
  line(pending.length === 0 ? "PASS" : "WARN", "no payments left waiting", pending.length ? `ids ${pending.map((p) => p.id).join(", ")}; run npm run demo:reset` : "");
  const reqs = await api<RequestView[]>("/requests");
  const open = reqs.filter((r) => r.status === "waiting_puck");
  line(open.length === 0 ? "PASS" : "WARN", "no requests waiting on the puck", open.length ? `request ${open.map((r) => r.reqId).join(", ")}` : "");

  if (config.mode === "testnet") {
    line(health.hcs && config.topicId ? "PASS" : "FAIL", "public log topic set", config.topicId ?? "none");
    const log = await api<any>("/log");
    const entries: any[] = Array.isArray(log) ? log : Object.values(log).find(Array.isArray) ?? [];
    const hcs = entries.filter((e) => e.kind === "hcs");
    line(hcs.length > 0 ? "PASS" : "WARN", "public log is read back from the mirror node", `${hcs.length} entries`);
    const block = await fetch(`${config.mirrorUrl}/api/v1/blocks?limit=1&order=desc`).then((r) => r.json()).catch(() => null);
    const chainNow = Number(String(block?.blocks?.[0]?.timestamp?.to ?? "0").split(".")[0]);
    const drift = chainNow ? Math.abs(chainNow - now) : -1;
    line(drift >= 0 && drift <= 15 ? "PASS" : "WARN", "laptop clock matches the network", drift >= 0 ? `${drift} s apart` : "could not read");
  }

  line(health.agent ? "PASS" : "WARN", "helper agent loaded");
  if (config.llmKey && config.llmModel) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.llmModel}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.llmKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }] }),
        signal: AbortSignal.timeout(20000),
      });
      line(r.ok ? "PASS" : "WARN", "language model answers", r.ok ? config.llmModel : `${config.llmModel} returned ${r.status}; the helper will use its fixed rules`);
    } catch (e) {
      line("WARN", "language model answers", `${(e as Error).message}; the helper will use its fixed rules`);
    }
  } else {
    line("WARN", "language model configured", "no LLM_API_KEY or LLM_MODEL; the helper uses its fixed rules");
  }

  console.log(`\n${fails ? `${fails} FAIL` : "READY"}${warns ? `, ${warns} warning${warns > 1 ? "s" : ""}` : ""}`);
}

main()
  .catch((e) => {
    line("FAIL", "check crashed", (e as Error).message);
  })
  .finally(() => process.exit(fails ? 1 : 0));
