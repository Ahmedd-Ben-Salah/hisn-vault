import { Contract, Wallet, getBytes, ethers, getAddress } from "ethers";
import {
  USDC_TESTNET,
  evmAddressToEntityId,
  payDigest,
} from "@hisn/shared";
import vectors from "../../../shared/test-vectors.json";
import {
  provider,
  relayer,
  deployContract,
  at,
  mirrorRetry,
  sleep,
  txLink,
  results,
  opt,
  setEnv,
  weibarToTinybar,
} from "../lib/env";

const GAS = { gasLimit: 3_000_000 };

async function probe(r: Wallet, fundHbar = 20n): Promise<Contract> {
  const existing = opt("DAY1_PROBE_ADDRESS");
  if (existing && !process.argv.includes("--fresh")) return at("Day1Probe", existing, r);
  const c = await deployContract("Day1Probe", r, [], fundHbar * 100_000_000n);
  const addr = await c.getAddress();
  setEnv({ DAY1_PROBE_ADDRESS: addr });
  console.log(`probe deployed at ${addr}`);
  return c;
}

async function contractResult(hash: string) {
  return mirrorRetry<any>(`/api/v1/contracts/results/${hash}`);
}

async function test1() {
  const p = provider();
  const r = relayer(p);
  const c = await deployContract("Day1Probe", r, [], 20n * 100_000_000n);
  const addr = await c.getAddress();
  setEnv({ DAY1_PROBE_ADDRESS: addr });
  const bal = await p.getBalance(addr);
  const to = opt("DEMO_RECIPIENT_ADDRESS") || Wallet.createRandom().address;
  const before = await p.getBalance(to);
  const tx = await c.payout(to, 100_000_000n, GAS);
  const rc = await tx.wait();
  await sleep(4000);
  const after = await p.getBalance(to);
  const diffTiny = weibarToTinybar(after - before);
  const info = await mirrorRetry<any>(`/api/v1/contracts/${addr}`);
  results("Test 1: vault pays out HBAR", diffTiny === 100_000_000n, [
    `probe ${addr} (${info.contract_id}), balance after deploy ${weibarToTinybar(bal)} tinybar`,
    `payout 1 HBAR to ${to}: recipient balance moved by ${diffTiny} tinybar`,
    `admin key shown by the mirror node: ${JSON.stringify(info.admin_key)}`,
    `gas used ${rc!.gasUsed}`,
    `payout tx ${txLink(tx.hash)}`,
  ]);
}

async function test2() {
  const USDC = getAddress(opt("USDC_ADDRESS", USDC_TESTNET).toLowerCase());
  const p = provider();
  const r = relayer(p);
  const c = await probe(r);
  const addr = await c.getAddress();
  const usdc = new Contract(
    USDC,
    ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"],
    r,
  );
  const a = await (await c.associate(USDC, GAS)).wait();
  const assocRc = await c.lastAssociateRc();
  const relBal = await usdc.balanceOf(r.address);
  const lines = [`associate() rc ${assocRc} tx ${txLink(a!.hash)}`, `relayer USDC balance ${relBal}`];
  if (relBal < 2_000_000n) {
    results("Test 2: vault holds and sends USDC", null, [...lines, "relayer has under 2 USDC; collect from the Circle faucet and rerun"]);
    return;
  }
  const t = await (await usdc.transfer(addr, 2_000_000n, GAS)).wait();
  await sleep(4000);
  const vBal = await usdc.balanceOf(addr);
  const to = opt("DEMO_RECIPIENT_ADDRESS") || r.address;
  const before = await usdc.balanceOf(to);
  const s = await (await c.sendToken(USDC, to, 1_000_000n, GAS)).wait();
  await sleep(4000);
  const after = await usdc.balanceOf(to);
  results("Test 2: vault holds and sends USDC", vBal >= 2_000_000n && BigInt(after) - BigInt(before) === 1_000_000n, [
    ...lines,
    `deposit 2 USDC tx ${txLink(t!.hash)}; probe balance ${vBal}`,
    `send 1 USDC to ${to}: moved ${BigInt(after) - BigInt(before)} tx ${txLink(s!.hash)}`,
  ]);
}

async function test3(deleteIt: boolean) {
  const p = provider();
  const r = relayer(p);
  const c = await probe(r);
  const addr = await c.getAddress();
  const delay = Number(opt("DAY1_DELAY", "60"));
  const execGas = BigInt(opt("EXEC_GAS", "1000000"));
  const balBefore = await p.getBalance(addr);
  const countBefore = await c.pingCount();
  const arg = BigInt(Date.now());
  const tx = await c.scheduleSelf(delay, execGas, arg, GAS);
  const rc = await tx.wait();
  const sched = await c.lastSchedule();
  const schedRc = await c.lastScheduleRc();
  const when = await c.lastScheduleWhen();
  const res = await contractResult(tx.hash);
  const schedId = evmAddressToEntityId(sched);
  const lines = [
    `scheduleCall rc ${schedRc}, schedule ${sched} (${schedId ?? "?"}), when ${when}`,
    `scheduling tx gas used ${res.gas_used ?? rc!.gasUsed} ${txLink(tx.hash)}`,
  ];
  if (sched === ethers.ZeroAddress) {
    results(deleteIt ? "Test 4: deleteSchedule cancels" : "Test 3: vault schedules its own call", false, [...lines, "no schedule created"]);
    return;
  }
  if (deleteIt) {
    const d = await (await c.deleteSched(sched, GAS)).wait();
    lines.push(`deleteSchedule rc ${await c.lastDeleteRc()} tx ${txLink(d!.hash)}`);
  }
  const deadline = Number(when) + 45;
  while (Math.floor(Date.now() / 1000) < deadline) await sleep(5000);
  const countAfter = await c.pingCount();
  const fired = countAfter > countBefore && (await c.lastPingArg()) === arg;
  let schedInfo: any = null;
  if (schedId) {
    try {
      schedInfo = await mirrorRetry<any>(`/api/v1/schedules/${schedId}`, 5);
    } catch {
      schedInfo = null;
    }
  }
  const balAfter = await p.getBalance(addr);
  lines.push(`probe HBAR change ${weibarToTinybar(balAfter - balBefore)} tinybar`);
  if (schedInfo) lines.push(`mirror schedule: executed ${schedInfo.executed_timestamp ?? "no"}, deleted ${schedInfo.deleted}`);
  if (deleteIt) {
    results("Test 4: deleteSchedule cancels", !fired, [...lines, `ping fired after delete: ${fired}`]);
  } else {
    if (fired) {
      lines.push(`ping ran at ${await c.lastPingAt()} (chosen second ${when}, offset ${(await c.lastPingAt()) - when} s)`);
      lines.push(`msg.sender inside the scheduled call ${await c.lastPingSender()}`);
    }
    results("Test 3: vault schedules its own call", fired, [...lines, `ping fired: ${fired}`]);
  }
}

async function test5() {
  const p = provider();
  const r = relayer(p);
  const c = await probe(r);
  const v = vectors.cases.find((x) => x.name === "pay_usdc_100")!;
  const f = v.fields as unknown as Record<string, string>;
  const deviceSig = opt("DEVICE_SIG") || v.signature.serialized;
  const expected = vectors.keys.puck.address;
  const got = await c.recoverPay(vectors.vault, f.to, f.token, f.amount, f.nonce, f.deadline, deviceSig);
  const changed = await c.recoverPay(vectors.vault, f.to, f.token, BigInt(f.amount) + 1n, f.nonce, f.deadline, deviceSig);
  const ctx = { chainId: 296n, vault: vectors.vault };
  const local = payDigest(ctx, { to: f.to, token: f.token, amount: BigInt(f.amount), nonce: BigInt(f.nonce), deadline: BigInt(f.deadline) });
  results("Test 5: device signature accepted by ecrecover on testnet", got === expected && changed !== expected, [
    `signature source: ${opt("DEVICE_SIG") ? "ESP32 (DEVICE_SIG)" : "test vector (ESP32 not yet connected)"}`,
    `digest ${local} (bytes ${getBytes(local).length})`,
    `recovered ${got}, expected ${expected}`,
    `one-byte change recovers ${changed}`,
  ]);
}

async function main() {
  const which = process.argv[2];
  if (!which) throw new Error("usage: npm -w contracts run day1 -- <1|2|3|4|5> [--fresh]");
  if (which === "1") return test1();
  if (which === "2") return test2();
  if (which === "3") return test3(false);
  if (which === "4") return test3(true);
  if (which === "5") return test5();
  throw new Error(`unknown test ${which}; test 6 (HCS) lives in scripts/hcs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
