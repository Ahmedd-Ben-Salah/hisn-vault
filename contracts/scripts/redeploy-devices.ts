import { getAddress } from "ethers";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { opt, setEnv, ENV_PATH, ROOT } from "./lib/env";

const GUARDIAN_PAGE_DEFAULT = "0xe10A046d818bE79B9Dd4c3fD9F06d6Cc57Fe4D09";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`--${name} needs a value`);
  return v;
}

function addr(v: string, what: string): string {
  try {
    return getAddress(v.toLowerCase());
  } catch {
    throw new Error(`${what} is not an address: ${v}`);
  }
}

function run(script: string) {
  const env = { ...process.env };
  for (const k of ["VAULT_ADDRESS", "VAULT_ID", "HCS_TOPIC_ID"]) delete env[k];
  const r = spawnSync("npx", ["tsx", script], { cwd: resolve(ROOT, "contracts"), stdio: "inherit", shell: process.platform === "win32", env });
  if (r.status !== 0) throw new Error(`${script} failed`);
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const currentGuardians = opt("GUARDIAN_ADDRESSES").split(",").map((s) => s.trim()).filter(Boolean);
  const puck = arg("puck") ? addr(arg("puck")!, "--puck") : addr(opt("PUCK_ADDRESS"), "PUCK_ADDRESS");
  const light = arg("light") ? addr(arg("light")!, "--light") : null;
  const pqRoot = arg("pq-root");
  if (pqRoot && !/^0x[0-9a-fA-F]{64}$/.test(pqRoot)) throw new Error("--pq-root must be 0x followed by 64 hex characters (puck console: pq)");
  if (arg("puck") && !pqRoot && opt("PQ") !== "0") throw new Error("a new puck needs its --pq-root (puck console: pq), or PQ=0 in .env for a classical-only vault");
  const page = addr(arg("guardian-page") ?? GUARDIAN_PAGE_DEFAULT, "--guardian-page");
  const firstGuardian = arg("guardian") ? addr(arg("guardian")!, "--guardian") : addr(currentGuardians[0], "first guardian");
  const watchers = light ? [light] : opt("WATCHER_ADDRESSES").split(",").map((s) => s.trim()).filter(Boolean).map((a) => addr(a, "watcher"));
  const guardians = [firstGuardian, page];

  const keys = [puck, ...guardians, ...watchers].map((a) => a.toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error("the puck, guardians and light must all be different keys");
  const payees = opt("PAYEE_ADDRESSES").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (keys.some((k) => payees.includes(k))) throw new Error("a device key is also a saved payee");

  console.log("new vault plan:");
  console.log(`  puck       ${puck}${arg("puck") ? "" : " (unchanged)"}`);
  console.log(`  guardians  ${guardians.join(", ")}  (second one is the guardian page)`);
  console.log(`  light      ${watchers.join(", ")}${light ? "" : " (unchanged, simulated)"}`);
  console.log(`  payees     ${opt("PAYEE_ADDRESSES")}`);
  console.log(`  pq root    ${pqRoot ?? (opt("PQ_ROOT") || "derived from SIM_PUCK_PRIVATE_KEY")}`);
  if (dry) {
    console.log("dry run: nothing deployed");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = resolve(ROOT, ".backups");
  mkdirSync(backups, { recursive: true });
  copyFileSync(ENV_PATH, resolve(backups, `env-${stamp}`));
  const dep = resolve(ROOT, "deployments", "testnet.json");
  if (existsSync(dep)) copyFileSync(dep, resolve(backups, `testnet-${stamp}.json`));
  console.log(`backed up .env and testnet.json to .backups/*-${stamp}`);

  setEnv({ PUCK_ADDRESS: puck, GUARDIAN_ADDRESSES: guardians.join(","), WATCHER_ADDRESSES: watchers.join(","), REUSE_TOPIC: "0", ...(pqRoot ? { PQ_ROOT: pqRoot } : {}) });
  run("scripts/deploy.ts");
  run("scripts/reset.ts");
  console.log("done. Restart the relayer, then type `vault <new address>` on each device.");
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
