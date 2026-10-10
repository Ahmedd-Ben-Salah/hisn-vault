import { Wallet, ZeroAddress, getBytes } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ChangeKind,
  changeDigest,
  changeApproveDigest,
  changeVetoDigest,
  encodeChangeData,
  payDigest,
  hashscanContract,
  USDC_TESTNET,
} from "@hisn/shared";
import { provider, relayer, deployContract, opt, sleep, txLink, ROOT } from "./lib/env";
import { chainNow, nonce } from "./lib/actors";

const GAS = { gasLimit: 1_500_000 };
const TINY = 100_000_000n;
const STATUS = ["NONE", "PENDING", "EXECUTED", "VETOED", "CANCELLED", "EXPIRED"];
const RECOVERY_DELAY = Number(opt("RECOVERY_TEST_DELAY", "120"));

const fresh = () => new Wallet(Wallet.createRandom().privateKey);
const lines: string[] = [];
let failed = 0;

function record(ok: boolean, what: string, detail: string) {
  if (!ok) failed++;
  lines.push(`| ${ok ? "PASS" : "FAIL"} | ${what} | ${detail} |`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${detail}`);
}

async function main() {
  const r = relayer(provider());
  const puck = fresh();
  const g1 = fresh();
  const g2 = fresh();
  const watcher = fresh();
  const im = {
    minCoolOff: 60,
    settingsDelay: 60,
    recoveryDelay: RECOVERY_DELAY,
    approvalWindow: 1800,
    freezeMax: 600,
    probation: 0,
    gasReserve: 1n * TINY,
    execGas: 1_000_000n,
  };
  const lim = { instantMax: 1n * TINY, waitMax: 5n * TINY, dailyCap: 2n * TINY, agentDailyMax: 0n };
  const usdc = opt("USDC_ADDRESS", USDC_TESTNET).toLowerCase();
  const vault = await deployContract(
    "HisnVault",
    r,
    [puck.address, [g1.address, g2.address], [watcher.address], ZeroAddress, usdc, 60, im, lim, lim, []],
    2n * TINY,
  );
  const vaultAddr = await vault.getAddress();
  const ctx = { chainId: 296n, vault: vaultAddr };
  console.log(`throwaway vault ${vaultAddr}`);

  async function reverts(what: string, call: () => Promise<unknown>, expected: string) {
    try {
      await call();
      record(false, what, "call succeeded");
    } catch (e: any) {
      const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
      let name = "";
      try {
        name = vault.interface.parseError(data)?.name ?? "";
      } catch {
        name = "";
      }
      record(name === expected, what, `reverted with ${name || e?.shortMessage || "unknown"}`);
    }
  }

  async function proposeRecovery(by: Wallet, to: string): Promise<bigint> {
    const c = { kind: ChangeKind.RECOVER_PUCK as const, address: to };
    const n = nonce();
    const deadline = (await chainNow(vault)) + 120n;
    const sig = await by.signMessage(getBytes(changeDigest(ctx, c, await vault.keyEpoch(), n, deadline)));
    const rc = await (await vault.proposeChange(ChangeKind.RECOVER_PUCK, encodeChangeData(c), n, deadline, sig, GAS)).wait();
    record(true, `guardian proposes a new puck ${to.slice(0, 10)}…`, txLink(rc!.hash));
    return await vault.changeCount();
  }

  const approveSig = async (by: Wallet, id: bigint) => {
    const ch = await vault.getChange(id);
    return by.signMessage(getBytes(changeApproveDigest(ctx, id, ChangeKind.RECOVER_PUCK, ch.data)));
  };

  lines.push("## Run A: the old puck cancels a recovery", "", "| Result | Step | Detail |", "|---|---|---|");
  const stolenTo = fresh().address;
  const a = await proposeRecovery(g1, stolenTo);
  const v = await (await vault.vetoChange(a, await puck.signMessage(getBytes(changeVetoDigest(ctx, a))), GAS)).wait();
  const aStatus = STATUS[Number((await vault.getChange(a)).status)];
  record(aStatus === "VETOED", "the owner's puck stops it", `change ${a} is ${aStatus} ${txLink(v!.hash)}`);
  record((await vault.puck()) === puck.address, "the puck is unchanged", await vault.puck());

  lines.push("", "## Run B: two different guardians replace a lost puck", "", "| Result | Step | Detail |", "|---|---|---|");
  const newPuck = fresh();
  const b = await proposeRecovery(g1, newPuck.address);
  await reverts("applying it with no second guardian", () => vault.executeChange.staticCall(b), "NotConfirmed");
  await reverts("the proposing guardian approving its own recovery", async () => vault.approveChange.staticCall(b, await approveSig(g1, b)), "SameApprover");
  const ap = await (await vault.approveChange(b, await approveSig(g2, b), GAS)).wait();
  record(true, "a second guardian approves", txLink(ap!.hash));
  await reverts("applying it before the recovery delay", () => vault.executeChange.staticCall(b), "NotReady");
  const readyAt = (await vault.getChange(b)).readyAt as bigint;
  console.log(`waiting ${Number(readyAt - (await chainNow(vault)))} s for the recovery delay`);
  for (;;) {
    await sleep(5000);
    const t = await chainNow(vault).catch(() => 0n);
    if (t > readyAt + 2n) break;
  }
  const ex = await (await vault.executeChange(b, GAS)).wait();
  const now = await vault.puck();
  record(now === newPuck.address, `applied after the ${RECOVERY_DELAY} s delay`, `puck is now ${now} ${txLink(ex!.hash)}`);

  const to = fresh().address;
  const n = nonce();
  const deadline = (await chainNow(vault)) + 120n;
  const digest = payDigest(ctx, { to, token: ZeroAddress, amount: 1n * TINY, nonce: n, deadline });
  await reverts("the old puck can no longer sign a payment", async () => vault.propose.staticCall(to, ZeroAddress, 1n * TINY, n, deadline, await puck.signMessage(getBytes(digest))), "BadSignature");
  try {
    await vault.propose.staticCall(to, ZeroAddress, 1n * TINY, n, deadline, await newPuck.signMessage(getBytes(digest)));
    record(true, "the new puck signs a payment", "accepted in simulation, nothing sent");
  } catch (e: any) {
    record(false, "the new puck signs a payment", e?.shortMessage ?? String(e));
  }

  const md = [
    "# Lost-puck recovery on testnet",
    "",
    `Run ${new Date().toISOString()} on a throwaway vault (${hashscanContract(vaultAddr)}) with the same contract as the demo vault, fresh random keys, and a ${RECOVERY_DELAY} s recovery delay. The demo vault was not touched. Not part of the live demo.`,
    "",
    ...lines,
    "",
  ];
  writeFileSync(resolve(ROOT, "docs", "RECOVERY_TEST.md"), md.join("\n"));
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
