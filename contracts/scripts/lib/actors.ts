import { Contract, Wallet, getBytes, randomBytes, toBigInt } from "ethers";
import {
  payDigest,
  reconfirmDigest,
  vetoDigest,
  approveDigest,
  cancelDigest,
  freezeDigest,
  DigestContext,
} from "@hisn/shared";
import { need, opt } from "./env";

export function simKeys() {
  const puck = new Wallet(need("SIM_PUCK_PRIVATE_KEY"));
  const guardians = opt("SIM_GUARDIAN_PRIVATE_KEYS")
    .split(",")
    .filter(Boolean)
    .map((k) => new Wallet(k.trim()));
  const watcher = opt("SIM_WATCHER_PRIVATE_KEY") ? new Wallet(need("SIM_WATCHER_PRIVATE_KEY")) : null;
  return { puck, guardians, watcher };
}

export function nonce(): bigint {
  return toBigInt(randomBytes(8));
}

export async function chainNow(vault: Contract): Promise<bigint> {
  const b = await vault.runner!.provider!.getBlock("latest");
  return BigInt(b!.timestamp);
}

export async function signPay(ctx: DigestContext, w: Wallet, to: string, token: string, amount: bigint, now: bigint) {
  const n = nonce();
  const deadline = now + 120n;
  const sig = await w.signMessage(getBytes(payDigest(ctx, { to, token, amount, nonce: n, deadline })));
  return [to, token, amount, n, deadline, sig] as const;
}

export async function signReconfirm(ctx: DigestContext, w: Wallet, id: bigint, now: bigint) {
  const n = nonce();
  const deadline = now + 120n;
  return [id, n, deadline, await w.signMessage(getBytes(reconfirmDigest(ctx, id, n, deadline)))] as const;
}

export const signVeto = (ctx: DigestContext, w: Wallet, id: bigint) => w.signMessage(getBytes(vetoDigest(ctx, id)));
export const signApprove = (ctx: DigestContext, w: Wallet, id: bigint) => w.signMessage(getBytes(approveDigest(ctx, id)));
export const signCancel = (ctx: DigestContext, w: Wallet, id: bigint) => w.signMessage(getBytes(cancelDigest(ctx, id)));
export const signFreeze = (ctx: DigestContext, w: Wallet, epoch: bigint) => w.signMessage(getBytes(freezeDigest(ctx, epoch)));

export function proposedId(vault: Contract, receipt: { logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }> }) {
  for (const l of receipt.logs) {
    try {
      const e = vault.interface.parseLog({ topics: [...l.topics], data: l.data });
      if (e?.name === "Proposed") return { id: e.args.id as bigint, tier: Number(e.args.tier), releaseAt: e.args.releaseAt as bigint, confirmFrom: e.args.confirmFrom as bigint };
    } catch {
      continue;
    }
  }
  throw new Error("no Proposed event");
}
