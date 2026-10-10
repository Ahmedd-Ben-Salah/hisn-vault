import { Contract } from "ethers";
import { TINYBAR_TO_WEIBAR, USDC_TESTNET } from "@hisn/shared";
import { provider, relayer, at, need, opt } from "./lib/env";
import { simKeys, signCancel } from "./lib/actors";

const GAS = { gasLimit: 1_500_000 };

async function main() {
  const p = provider();
  const r = relayer(p);
  const vault = at("HisnVault", need("VAULT_ADDRESS"), r);
  const ctx = { chainId: 296n, vault: await vault.getAddress() };
  const { puck } = simKeys();
  const pending: bigint[] = await vault.getPendingIds();
  for (const id of pending) {
    const pay = await vault.getPayment(id);
    const now = BigInt((await p.getBlock("latest"))!.timestamp);
    if (now > pay.expiresAt) await (await vault.expire(id, GAS)).wait();
    else await (await vault.cancel(id, await signCancel(ctx, puck, id), GAS)).wait();
    console.log(`closed payment ${id}`);
  }
  const target = BigInt(opt("VAULT_TARGET_HBAR", "40")) * 100_000_000n;
  const bal = (await p.getBalance(await vault.getAddress())) / TINYBAR_TO_WEIBAR;
  if (bal < target) {
    await (await r.sendTransaction({ to: await vault.getAddress(), value: (target - bal) * TINYBAR_TO_WEIBAR, gasLimit: 100_000 })).wait();
    console.log(`topped up ${Number(target - bal) / 1e8} HBAR`);
  }
  const usdc = new Contract(
    opt("USDC_ADDRESS", USDC_TESTNET).toLowerCase(),
    ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"],
    r,
  );
  const usdTarget = BigInt(opt("VAULT_TARGET_USDC", "2000")) * 1_000_000n;
  const usdBal: bigint = await usdc.balanceOf(await vault.getAddress());
  if (usdBal < usdTarget) {
    const have: bigint = await usdc.balanceOf(r.address);
    const send = usdTarget - usdBal < have ? usdTarget - usdBal : have;
    if (send > 0n) {
      await (await usdc.transfer(await vault.getAddress(), send, GAS)).wait();
      console.log(`topped up ${send / 1_000_000n} USDC`);
    } else console.log("relayer has no USDC to top up with");
  }
  console.log(`frozen ${await vault.isFrozen()}, pending ${(await vault.getPendingIds()).length}, HBAR ${(await p.getBalance(await vault.getAddress())) / TINYBAR_TO_WEIBAR} tinybar`);
  console.log(`vault USDC ${await usdc.balanceOf(await vault.getAddress())}`);
  console.log(`relayer ${r.address} HBAR ${(await p.getBalance(r.address)) / TINYBAR_TO_WEIBAR} tinybar`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
