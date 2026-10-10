import { Contract, Wallet } from "ethers";
import { USDC_TESTNET, HBAR, evmAddressToEntityId, hashscanSchedule } from "@hisn/shared";
import { provider, relayer, at, need, opt, sleep, txLink, mirrorRetry } from "./lib/env";
import { simKeys, chainNow, signPay, signReconfirm, signVeto, signApprove, proposedId } from "./lib/actors";

const GAS = { gasLimit: 3_000_000 };

async function waitUntil(vault: Contract, t: bigint) {
  while ((await chainNow(vault)) < t) await sleep(3000);
}

async function main() {
  const p = provider();
  const r = relayer(p);
  const vault = at("HisnVault", need("VAULT_ADDRESS"), r);
  const ctx = { chainId: 296n, vault: await vault.getAddress() };
  const { puck, guardians, watcher } = simKeys();
  const token = opt("SMOKE_TOKEN", "HBAR") === "USDC" ? opt("USDC_ADDRESS", USDC_TESTNET).toLowerCase() : HBAR;
  const unit = token === HBAR ? 100_000_000n : 1_000_000n;
  const payees: string[] = await vault.getPayees();
  const saved = payees[0];
  const stranger = opt("DEMO_RECIPIENT_ADDRESS") || Wallet.createRandom().address;
  const log: string[] = [];
  const only = process.argv.slice(2);
  const run = (name: string) => only.length === 0 || only.includes(name);

  if (run("instant") && saved) {
    const t = await (await vault.propose(...(await signPay(ctx, puck, saved, token, 5n * unit, await chainNow(vault))), GAS)).wait();
    const ev = proposedId(vault, t!);
    log.push(`INSTANT id ${ev.id} tier ${ev.tier} ${txLink(t!.hash)}`);
  }

  if (run("wait")) {
    const t = await (await vault.propose(...(await signPay(ctx, puck, stranger, token, 2n * unit, await chainNow(vault))), GAS)).wait();
    const ev = proposedId(vault, t!);
    log.push(`WAIT id ${ev.id} tier ${ev.tier} releaseAt ${ev.releaseAt} ${txLink(t!.hash)}`);
    await waitUntil(vault, ev.confirmFrom + 2n);
    const c = await (await vault.reconfirm(...(await signReconfirm(ctx, puck, ev.id, await chainNow(vault))), GAS)).wait();
    const pay = await vault.getPayment(ev.id);
    const sid = evmAddressToEntityId(pay.schedule);
    log.push(`reconfirmed ${txLink(c!.hash)} schedule ${pay.schedule} ${sid ? hashscanSchedule(sid) : ""}`);
    console.log("relayer can be switched off now; waiting for the network to release");
    await waitUntil(vault, ev.releaseAt + 25n);
    const after = await vault.getPayment(ev.id);
    log.push(`after release time: status ${after.status} (2 = EXECUTED by the network)`);
    if (sid) {
      const s = await mirrorRetry<any>(`/api/v1/schedules/${sid}`, 5).catch(() => null);
      if (s) log.push(`mirror schedule executed_timestamp ${s.executed_timestamp}`);
    }
  }

  if (run("veto")) {
    const t = await (await vault.propose(...(await signPay(ctx, puck, stranger, token, 2n * unit, await chainNow(vault))), GAS)).wait();
    const ev = proposedId(vault, t!);
    const vetoer = watcher ?? guardians[0];
    const v = await (await vault.veto(ev.id, await signVeto(ctx, vetoer, ev.id), GAS)).wait();
    log.push(`VETO id ${ev.id} status ${(await vault.getPayment(ev.id)).status} ${txLink(v!.hash)}`);
  }

  if (run("approval")) {
    const big = (await vault.spendable(token)) / 2n + unit;
    const t = await (await vault.propose(...(await signPay(ctx, puck, stranger, token, big, await chainNow(vault))), GAS)).wait();
    const ev = proposedId(vault, t!);
    const a = await (await vault.approve(ev.id, await signApprove(ctx, guardians[0], ev.id), GAS)).wait();
    log.push(`APPROVAL id ${ev.id} tier ${ev.tier} approved ${txLink(a!.hash)}; vetoing it again so the demo funds stay`);
    await (await vault.veto(ev.id, await signVeto(ctx, guardians[1] ?? guardians[0], ev.id), GAS)).wait();
  }

  console.log(log.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
