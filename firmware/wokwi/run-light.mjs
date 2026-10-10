import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const tunnel = (process.argv[2] ?? process.env.TUNNEL_URL ?? "").replace(/\/+$/, "");
const cli = process.env.WOKWI_CLI ?? resolve(homedir(), ".local/share/wokwi/wokwi-cli");
const out = resolve(homedir(), ".cache/hisn-docs/wokwi");
const api = `http://127.0.0.1:${env.RELAYER_PORT ?? 8787}`;
const auth = { authorization: `Bearer ${env.RELAYER_API_TOKEN}` };
const sami = (env.PAYEE_ADDRESSES ?? "").split(",")[0];
const amount = String(BigInt(process.env.TEST_AMOUNT_USDC ?? "60") * 1_000_000n);

const wokwiToken = process.env.WOKWI_CLI_TOKEN || env.WOKWI_CLI_TOKEN;
if (!wokwiToken) throw new Error("set WOKWI_CLI_TOKEN in .env (wokwi.com/dashboard/ci)");
if (!/^https:\/\//.test(tunnel)) throw new Error("usage: node run-light.mjs https://<tunnel>.trycloudflare.com");
mkdirSync(out, { recursive: true });

const q = (s) => JSON.stringify(s);
const say = (cmd, expect) => [`  - write-serial: ${q(`${cmd}\n`)}`, `  - wait-serial: ${q(expect)}`];
const steps = [
  '  - wait-serial: "address"',
  ...say(`relayer ${new URL(tunnel).host} ${process.env.WOKWI_RELAYER_PORT ?? "80"}`, "saved"),
  ...say(`token ${env.RELAYER_API_TOKEN}`, "saved"),
  ...say(`vault ${env.VAULT_ADDRESS}`, "saved"),
  ...say(`simkey ${env.SIM_WATCHER_PRIVATE_KEY}`, "simkey stored"),
  ...say('wifi 0 "Wokwi-GUEST" ""', "saved"),
  '  - wait-serial: "link: up"',
  '  - wait-serial: "mode ALARM_WAIT"',
  "  - delay: 3000ms",
  "  - set-control: { part-id: btnVeto, control: pressed, value: 1 }",
  '  - wait-serial: "stop sent"',
  "  - set-control: { part-id: btnVeto, control: pressed, value: 0 }",
  '  - wait-serial: "mode CALM"',
  "  - delay: 1000ms",
];
const scenario = resolve(out, "light.scenario.yaml");
writeFileSync(scenario, ["name: HISN light on testnet", "version: 1", "author: HISN", "steps:", ...steps, ""].join("\n"), { mode: 0o600 });

async function get(path) {
  const r = await fetch(`${api}${path}`, { headers: auth });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await get("/health");
if (health.devices.some((d) => d.online && d.id === "sim-light")) throw new Error("the node device simulator is connected as the light; stop it first (pkill -f 'tsx src/sim/devices.ts')");
const before = new Set((await get("/payments")).map((p) => p.id));

const puckSim = spawn("npx", ["tsx", "src/sim/devices.ts", "--auto"], { cwd: resolve(root, "backend"), stdio: ["ignore", "ignore", "inherit"], detached: true, env: { ...process.env, SIM_ONLY: "puck", SIM_PORT: "8791" } });
const killPuck = () => {
  try {
    process.kill(-puckSim.pid);
  } catch {}
};
const serialLog = resolve(out, "light-serial.log");
const sim = spawn(cli, [resolve(here, "light"), "--scenario", scenario, "--timeout", "420000", "--serial-log-file", serialLog], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, WOKWI_CLI_TOKEN: wokwiToken } });
const simDone = new Promise((r) => sim.on("exit", (code) => r(code)));
const stopAll = () => {
  sim.kill();
  killPuck();
};

const calmAfterBoot = () => {
  if (!existsSync(serialLog)) return false;
  const t = readFileSync(serialLog, "utf8");
  const up = t.lastIndexOf("link: up");
  return up >= 0 && t.indexOf("mode CALM", up) > 0;
};
let light = null;
let puckUp = false;
for (let i = 0; i < 150 && !(light && puckUp && calmAfterBoot()); i++) {
  await sleep(2000);
  const devs = (await get("/health")).devices;
  light = devs.find((d) => d.online && d.role === "watcher" && d.id.startsWith("light-"));
  puckUp = devs.some((d) => d.online && d.id === "sim-puck");
}
if (!light || !puckUp || !calmAfterBoot()) {
  stopAll();
  throw new Error("the virtual light and the node puck were not both online");
}
console.log(`\nvirtual light online: ${light.id} ${light.address}`);
const r = await fetch(`${api}/requests`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ to: sami, token: env.USDC_ADDRESS, amount, source: "dashboard" }) });
console.log(`payment request sent: ${r.status} ${await r.text()}`);

let pay = null;
const finished = { done: false };
simDone.then(() => (finished.done = true));
for (let i = 0; i < 150; i++) {
  await sleep(3000);
  pay = (await get("/payments")).find((p) => !before.has(p.id));
  if (pay && pay.status !== "PENDING") break;
  if (finished.done && i > 10) break;
}
const code = await simDone;
killPuck();
console.log(`\nwokwi exit ${code}`);
console.log(pay ? `payment #${pay.id}: ${pay.status}` : "no payment was proposed");
const ok = code === 0 && pay?.status === "VETOED";
console.log(ok ? "VIRTUAL LIGHT PASSED" : "VIRTUAL LIGHT FAILED");
console.log(`serial log in ${serialLog}`);
process.exit(ok ? 0 : 1);
