import { AbiCoder, Signature, concat, getBytes, hashMessage, keccak256, toUtf8Bytes, recoverAddress } from "ethers";

export const TAG = keccak256(toUtf8Bytes("HISN_V1"));

export enum Action {
  PAY = 1,
  AGENT_PAY = 2,
  VETO = 3,
  CANCEL = 4,
  APPROVE = 5,
  FREEZE = 6,
  CHANGE = 7,
  CHANGE_APPROVE = 8,
  CHANGE_VETO = 9,
  ALERT_ACK = 10,
  RECONFIRM = 11,
  RENEW_FREEZE = 12,
}

export interface DigestContext {
  chainId: bigint | number;
  vault: string;
}

export interface PayFields {
  to: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

const coder = AbiCoder.defaultAbiCoder();

function head(ctx: DigestContext, action: Action): { types: string[]; values: unknown[] } {
  return {
    types: ["bytes32", "uint256", "address", "uint8"],
    values: [TAG, BigInt(ctx.chainId), ctx.vault, action],
  };
}

export function encodeDigestInput(ctx: DigestContext, action: Action, types: string[], values: unknown[]): string {
  const h = head(ctx, action);
  return coder.encode([...h.types, ...types], [...h.values, ...values]);
}

function digestOf(ctx: DigestContext, action: Action, types: string[], values: unknown[]): string {
  return keccak256(encodeDigestInput(ctx, action, types, values));
}

const PAY_TYPES = ["address", "address", "uint256", "uint256", "uint256"];

export function payDigest(ctx: DigestContext, f: PayFields): string {
  return digestOf(ctx, Action.PAY, PAY_TYPES, [f.to, f.token, f.amount, f.nonce, f.deadline]);
}

export function agentPayDigest(ctx: DigestContext, f: PayFields): string {
  return digestOf(ctx, Action.AGENT_PAY, PAY_TYPES, [f.to, f.token, f.amount, f.nonce, f.deadline]);
}

export function vetoDigest(ctx: DigestContext, paymentId: bigint): string {
  return digestOf(ctx, Action.VETO, ["uint256"], [paymentId]);
}

export function cancelDigest(ctx: DigestContext, paymentId: bigint): string {
  return digestOf(ctx, Action.CANCEL, ["uint256"], [paymentId]);
}

export function approveDigest(ctx: DigestContext, paymentId: bigint): string {
  return digestOf(ctx, Action.APPROVE, ["uint256"], [paymentId]);
}

export function freezeDigest(ctx: DigestContext, epoch: bigint): string {
  return digestOf(ctx, Action.FREEZE, ["uint256"], [epoch]);
}

export function alertAckDigest(ctx: DigestContext, paymentId: bigint, nonce: bigint): string {
  return digestOf(ctx, Action.ALERT_ACK, ["uint256", "uint256"], [paymentId, nonce]);
}

export function reconfirmDigest(ctx: DigestContext, paymentId: bigint, nonce: bigint, deadline: bigint): string {
  return digestOf(ctx, Action.RECONFIRM, ["uint256", "uint256", "uint256"], [paymentId, nonce, deadline]);
}

export function renewFreezeDigest(ctx: DigestContext, epoch: bigint, frozenUntil: bigint): string {
  return digestOf(ctx, Action.RENEW_FREEZE, ["uint256", "uint256"], [epoch, frozenUntil]);
}

export enum ChangeKind {
  ADD_PAYEE = 0,
  REMOVE_PAYEE = 1,
  SET_LIMITS = 2,
  SET_COOLOFF = 3,
  SET_AGENT = 4,
  ADD_GUARDIAN = 5,
  REMOVE_GUARDIAN = 6,
  ADD_WATCHER = 7,
  REMOVE_WATCHER = 8,
  UNFREEZE = 9,
  RECOVER_PUCK = 10,
  SET_PQ_ROOT = 11,
}

export const CHANGE_KIND_NAMES = [
  "ADD_PAYEE",
  "REMOVE_PAYEE",
  "SET_LIMITS",
  "SET_COOLOFF",
  "SET_AGENT",
  "ADD_GUARDIAN",
  "REMOVE_GUARDIAN",
  "ADD_WATCHER",
  "REMOVE_WATCHER",
  "UNFREEZE",
  "RECOVER_PUCK",
  "SET_PQ_ROOT",
] as const;

export type ChangeFields =
  | { kind: ChangeKind.UNFREEZE }
  | { kind: ChangeKind.SET_COOLOFF; seconds: bigint }
  | { kind: ChangeKind.SET_PQ_ROOT; root: string }
  | { kind: ChangeKind.SET_LIMITS; token: string; instantMax: bigint; waitMax: bigint; dailyCap: bigint; agentDailyMax: bigint }
  | {
      kind:
        | ChangeKind.ADD_PAYEE
        | ChangeKind.REMOVE_PAYEE
        | ChangeKind.SET_AGENT
        | ChangeKind.ADD_GUARDIAN
        | ChangeKind.REMOVE_GUARDIAN
        | ChangeKind.ADD_WATCHER
        | ChangeKind.REMOVE_WATCHER
        | ChangeKind.RECOVER_PUCK;
      address: string;
    };

export function encodeChangeData(c: ChangeFields): string {
  switch (c.kind) {
    case ChangeKind.UNFREEZE:
      return "0x";
    case ChangeKind.SET_COOLOFF:
      return coder.encode(["uint256"], [c.seconds]);
    case ChangeKind.SET_PQ_ROOT:
      return coder.encode(["bytes32"], [c.root]);
    case ChangeKind.SET_LIMITS:
      return coder.encode(
        ["address", "uint256", "uint256", "uint256", "uint256"],
        [c.token, c.instantMax, c.waitMax, c.dailyCap, c.agentDailyMax],
      );
    default:
      return coder.encode(["address"], [c.address]);
  }
}

export function decodeChangeData(kind: ChangeKind, data: string): ChangeFields {
  switch (kind) {
    case ChangeKind.UNFREEZE:
      return { kind };
    case ChangeKind.SET_COOLOFF:
      return { kind, seconds: coder.decode(["uint256"], data)[0] as bigint };
    case ChangeKind.SET_PQ_ROOT:
      return { kind, root: coder.decode(["bytes32"], data)[0] as string };
    case ChangeKind.SET_LIMITS: {
      const [token, instantMax, waitMax, dailyCap, agentDailyMax] = coder.decode(
        ["address", "uint256", "uint256", "uint256", "uint256"],
        data,
      );
      return { kind, token, instantMax, waitMax, dailyCap, agentDailyMax };
    }
    default:
      return { kind, address: coder.decode(["address"], data)[0] as string };
  }
}

export function changeDigest(ctx: DigestContext, c: ChangeFields, keyEpoch: bigint, nonce: bigint, deadline: bigint): string {
  const h = head(ctx, Action.CHANGE);
  const pre = coder.encode([...h.types, "uint256", "uint256"], [...h.values, c.kind, keyEpoch]);
  const tail = coder.encode(["uint256", "uint256"], [nonce, deadline]);
  return keccak256(concat([pre, encodeChangeData(c), tail]));
}

export function changeApproveDigest(ctx: DigestContext, changeId: bigint, kind: ChangeKind, data: string): string {
  return digestOf(ctx, Action.CHANGE_APPROVE, ["uint256", "uint256", "bytes32"], [changeId, kind, keccak256(data)]);
}

export function changeVetoDigest(ctx: DigestContext, changeId: bigint): string {
  return digestOf(ctx, Action.CHANGE_VETO, ["uint256"], [changeId]);
}

export function ethSignedHash(digest: string): string {
  return hashMessage(getBytes(digest));
}

export function recoverSigner(digest: string, sig: string): string {
  return recoverAddress(ethSignedHash(digest), sig);
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function completeSignature(digest: string, r: string, s: string, expected: string): string | null {
  let sBig = BigInt(s);
  if (sBig > SECP256K1_N / 2n) sBig = SECP256K1_N - sBig;
  const sHex = "0x" + sBig.toString(16).padStart(64, "0");
  const hash = ethSignedHash(digest);
  for (const v of [27, 28]) {
    const sig = Signature.from({ r, s: sHex, v }).serialized;
    if (recoverAddress(hash, sig).toLowerCase() === expected.toLowerCase()) return sig;
  }
  return null;
}
