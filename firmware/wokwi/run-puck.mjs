import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync, readdirSync } from "node:fs";
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
if (!/^https:\/\//.test(tunnel)) throw new Error("usage: node run-puck.mjs https://<tunnel>.trycloudflare.com");
mkdirSync(out, { recursive: true });

const q = (s) => JSON.stringify(s);
const press = (id) => [
  "  - delay: 350ms",
  `  - set-control: { part-id: ${id}, control: pressed, value: 1 }`,
  "  - delay: 150ms",
  `  - set-control: { part-id: ${id}, control: pressed, value: 0 }`,
];
const pin = () => Array.from({ length: 3 }, () => press("btnOk")).flat();
const shot = (name) => [`  - take-screenshot: { part-id: oled, save-to: ${q(`shot-${name}.png`)} }`];
const say = (cmd, expect) => [`  - write-serial: ${q(`${cmd}\n`)}`, `  - wait-serial: ${q(expect)}`];

const steps = [
  '  - wait-serial: "address"',
  ...say(`relayer ${new URL(tunnel).host} ${process.env.WOKWI_RELAYER_PORT ?? "80"}`, "saved"),
  ...say(`token ${env.RELAYER_API_TOKEN}`, "saved"),
  ...say(`vault ${env.VAULT_ADDRESS}`, "saved"),
  ...say(`payee add ${sami} "Sami (son)"`, "saved"),
  ...say(`simkey ${env.SIM_PUCK_PRIVATE_KEY} 000`, "simkey stored"),
  ...say('wifi 0 "Wokwi-GUEST" ""', "saved"),
  '  - wait-serial: "link: up"',
  '  - wait-serial: "screen IDLE"',
  ...shot("1-idle"),
  '  - wait-serial: "screen REVIEW"',
  "  - delay: 1500ms",
  ...shot("2-review"),
  ...press("btnOk"),
  '  - wait-serial: "screen PIN"',
  "  - delay: 300ms",
  ...shot("3-pin"),
  ...pin(),
  '  - wait-serial: "result"',
  ...shot("4-signed"),
  '  - wait-serial: "screen REVIEW"',
  "  - delay: 1500ms",
  ...shot("5-still-send"),
  ...press("btnOk"),
  '  - wait-serial: "screen PIN"',
  ...pin(),
  '  - wait-serial: "result"',
  ...shot("6-confirmed"),
  "  - delay: 3000ms",
];
const scenario = resolve(out, "puck.scenario.yaml");
writeFileSync(scenario, ["name: HISN puck on testnet", "version: 1", "author: HISN", "steps:", ...steps, ""].join("\n"), { mode: 0o600 });

async function get(path) {
  const r = await fetch(`${api}${path}`, { headers: auth });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await get("/health");
if (health.devices.some((d) => d.online && d.id === "sim-puck")) throw new Error("the node device simulator is connected as the puck; stop it first (pkill -f 'tsx src/sim/devices.ts')");
const before = new Set((await get("/payments")).map((p) => p.id));

const sim = spawn(cli, [resolve(here, "puck"), "--scenario", scenario, "--timeout", "420000", "--serial-log-file", resolve(out, "puck-serial.log")], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, WOKWI_CLI_TOKEN: wokwiToken } });
const simDone = new Promise((r) => sim.on("exit", (code) => r(code)));

const serialLog = resolve(out, "puck-serial.log");
const idleAfterBoot = () => {
  if (!existsSync(serialLog)) return false;
  const t = readFileSync(serialLog, "utf8");
  const up = t.lastIndexOf("link: up");
  return up >= 0 && t.indexOf("screen IDLE", up) > 0;
};
let puck = null;
for (let i = 0; i < 150 && !(puck && idleAfterBoot()); i++) {
  await sleep(2000);
  puck = (await get("/health")).devices.find((d) => d.online && d.role === "puck" && d.id.startsWith("puck-"));
}
if (!puck || !idleAfterBoot()) {
  sim.kill();
  throw new Error("the virtual puck never reached its idle screen online");
}
console.log(`\nvirtual puck online: ${puck.id} ${puck.address}`);
const r = await fetch(`${api}/requests`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ to: sami, token: env.USDC_ADDRESS, amount, source: "dashboard" }) });
console.log(`payment request sent: ${r.status} ${await r.text()}`);

let pay = null;
for (let i = 0; i < 150; i++) {
  await sleep(3000);
  pay = (await get("/payments")).find((p) => !before.has(p.id));
  if (pay && (pay.status !== "PENDING" || i > 140)) break;
}
const code = await simDone;
for (const dir of [resolve(here, "puck"), out]) for (const f of readdirSync(dir)) if (f.startsWith("shot-")) renameSync(resolve(dir, f), resolve(out, f.slice(5)));
console.log(`\nwokwi exit ${code}`);
console.log(pay ? `payment #${pay.id}: ${pay.status}, confirmed ${pay.confirmed}, executed by ${pay.executedBy ?? "-"}` : "no payment was proposed");
const ok = code === 0 && pay?.status === "EXECUTED" && pay.executedBy === "network";
console.log(ok ? "VIRTUAL PUCK PASSED" : "VIRTUAL PUCK FAILED");
console.log(`screenshots and serial log in ${out}`);
process.exit(ok ? 0 : 1);
