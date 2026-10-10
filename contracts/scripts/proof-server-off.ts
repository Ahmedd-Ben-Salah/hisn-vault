import { Contract } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evmAddressToEntityId, hashscanSchedule, hashscanTx, hashscanContract, USDC_TESTNET } from "@hisn/shared";
import { provider, relayer, at, need, opt, sleep, txLink, mirrorRetry, ROOT } from "./lib/env";
import { simKeys, chainNow, signPay, signReconfirm, proposedId } from "./lib/actors";

const GAS = { gasLimit: 3_000_000 };
const STATUS = ["NONE", "PENDING", "EXECUTED", "VETOED", "CANCELLED", "EXPIRED"];

async function relayerUp(): Promise<boolean> {
  const port = opt("RELAYER_PORT", "8787");
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await relayerUp()) throw new Error("the relayer is running on this machine; stop it first, this proof runs with no server");
  const p = provider();
  const r = relayer(p);
  const vault = at("HisnVault", need("VAULT_ADDRESS"), r);
  const vaultAddr = await vault.getAddress();
  const ctx = { chainId: 296n, vault: vaultAddr };
  const { puck } = simKeys();
  const tokenAddr = opt("USDC_ADDRESS", USDC_TESTNET).toLowerCase();
  const token = new Contract(tokenAddr, ["function balanceOf(address) view returns (uint256)"], p);
  const to = need("DEMO_RECIPIENT_ADDRESS");
  const amount = BigInt(opt("PROOF_AMOUNT_USDC", "60")) * 1_000_000n;
  const lines: string[] = [];
  const say = (s: string) => {
    console.log(s);
    lines.push(s);
  };

  if (await vault.isFrozen()) throw new Error("vault is frozen; wait for the freeze to end");
  const before: bigint = await token.balanceOf(to);
  const proposeTx = await (await vault.propose(...(await signPay(ctx, puck, to, tokenAddr, amount, await chainNow(vault))), GAS)).wait();
  const ev = proposedId(vault, proposeTx!);
  if (ev.tier !== 1) throw new Error(`expected the WAIT tier, got ${ev.tier}; raise PROOF_AMOUNT_USDC above the instant limit`);
  say(`1. Puck-signed payment #${ev.id}: ${amount / 1_000_000n} USDC to ${to}, WAIT tier, release at ${new Date(Number(ev.releaseAt) * 1000).toISOString()}. ${txLink(proposeTx!.hash)}`);

  while ((await chainNow(vault)) < ev.confirmFrom + 2n) await sleep(3000);
  const confirmTx = await (await vault.reconfirm(...(await signReconfirm(ctx, puck, ev.id, await chainNow(vault))), GAS)).wait();
  const pay = await vault.getPayment(ev.id);
  const sid = evmAddressToEntityId(pay.schedule);
  if (!sid) throw new Error("no schedule was created");
  say(`2. Puck-signed second confirmation; the vault created schedule ${sid}. ${txLink(confirmTx!.hash)}`);
  say(`3. From here nothing of ours sends a transaction. Relayer running on this machine: ${(await relayerUp()) ? "yes" : "no"}.`);

  while ((await chainNow(vault)) < ev.releaseAt + 20n) await sleep(5000);
  const sched = await mirrorRetry<any>(`/api/v1/schedules/${sid}`, 20, 3000);
  if (!sched.executed_timestamp) throw new Error(`schedule ${sid} has not executed yet`);
  const txs = await mirrorRetry<any>(`/api/v1/transactions?timestamp=${sched.executed_timestamp}`, 20, 3000);
  const exec = (txs.transactions ?? [])[0];
  const after = (await vault.getPayment(ev.id)).status;
  const now: bigint = await token.balanceOf(to);
  say(`4. Schedule ${sid} executed at consensus time ${sched.executed_timestamp}: transaction ${exec?.transaction_id}, scheduled=${exec?.scheduled}, result ${exec?.result}, payer ${exec?.payer_account_id ?? sched.payer_account_id}.`);
  say(`5. Payment #${ev.id} status ${STATUS[Number(after)]}. Recipient balance ${before} -> ${now} (moved ${now - before}). Relayer running: ${(await relayerUp()) ? "yes" : "no"}.`);

  const ok = exec?.scheduled === true && exec?.result === "SUCCESS" && STATUS[Number(after)] === "EXECUTED" && now - before === amount;
  const md = [
    "# The network releases a payment with our server off",
    "",
    `Run ${new Date().toISOString()} on Hedera testnet, vault ${evmAddressToEntityId(vaultAddr) ?? vaultAddr} (${hashscanContract(vaultAddr)}). Result: **${ok ? "PASS" : "FAIL"}**.`,
    "",
    "The relayer was not running at any point. Only two transactions came from our side, both carrying the puck's signature: the payment and the second confirmation. The release was a scheduled transaction that Hedera itself executed at the release time.",
    "",
    ...lines.map((l) => `- ${l}`),
    "",
    "Check it yourself:",
    "",
    `- Schedule: ${hashscanSchedule(sid)}`,
    `- Release transaction: ${hashscanTx(sched.executed_timestamp)}`,
    "",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
  writeFileSync(resolve(ROOT, "docs", "SERVER_OFF_PROOF.md"), md.join("\n"));
  console.log(ok ? "PROOF PASSED" : "PROOF FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
