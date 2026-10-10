// Live check of the app's guardian signing (src/state/guardianLive.ts) against a local relayer.
// Usage: npx tsx scripts/check-guardian-live.ts   (needs `npm run local`, `npm run relayer:local` in the repo root)
// Reads the first simulated guardian key from ../.env.local; never prints it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet } from "ethers";
import { guardianLive } from "../src/state/guardianLive";

const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "..", "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const base = "http://localhost:8787";
const token = env.RELAYER_API_TOKEN ?? "local-dev";

async function main() {
  const wallet = new Wallet(String(env.SIM_GUARDIAN_PRIVATE_KEYS).split(",")[0].trim());
  const headers = { authorization: `Bearer ${token}` };
  const state = (await (await fetch(`${base}/state`, { headers })).json()) as { chainId: number; vault: string; guardians: string[] };
  console.log(`guardian ${wallet.address} listed by the vault: ${state.guardians.includes(wallet.address)}`);
  const payments = (await (await fetch(`${base}/payments`, { headers })).json()) as Array<{ id: number; status: string; confirmed: boolean }>;
  const target = payments.find((p) => p.status === "PENDING");
  if (!target) throw new Error("no pending payment to stop");
  const api = guardianLive(base, token, wallet, { chainId: state.chainId, vault: state.vault });
  const tx = await api.stop(target.id);
  console.log(`stop sent for payment ${target.id}, tx ${tx.slice(0, 12)}…`);
  await new Promise((r) => setTimeout(r, 2500));
  const after = (await (await fetch(`${base}/payments`, { headers })).json()) as Array<{ id: number; status: string }>;
  console.log(`payment ${target.id} is now ${after.find((p) => p.id === target.id)?.status}`);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
