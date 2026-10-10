import { Contract, Interface, JsonRpcProvider, Signature, getBytes, type InterfaceAbi, type Wallet } from "ethers";
import {
  approveDigest,
  changeApproveDigest,
  changeVetoDigest,
  decodeChangeData,
  freezeDigest,
  renewFreezeDigest,
  vetoDigest,
  type ChangeKind,
  type DigestContext,
} from "@hisn/shared";
import vaultJson from "../../shared/abi/HisnVault.json";
import { CHAIN_ID, MIRROR, RPC, type Config } from "./config";
import { STATUS, type Actions, type Chg, type Done, type Pay, type View } from "./model";

const ABI = ((vaultJson as { abi?: InterfaceAbi }).abi ?? vaultJson) as InterfaceAbi;
const iface = new Interface(ABI);

async function call<T = unknown>(vault: string, fn: string, args: unknown[] = []): Promise<T> {
  const data = iface.encodeFunctionData(fn, args);
  const res = await fetch(`${MIRROR}/api/v1/contracts/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: vault, data, block: "latest", estimate: false }),
  });
  if (!res.ok) throw new Error(`mirror node ${res.status}`);
  const { result } = (await res.json()) as { result: string };
  const out = iface.decodeFunctionResult(fn, result);
  return (out.length === 1 ? out[0] : out) as T;
}

type PaymentTuple = [string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, string];
type ChangeTuple = [bigint, string, bigint, bigint, bigint, string, string, bigint, bigint];

async function readPayment(v: string, id: bigint): Promise<Pay> {
  const t = (await call<PaymentTuple>(v, "getPayment", [id])) as PaymentTuple;
  const since = await call<bigint>(v, "payeeSince", [t[0]]);
  return {
    id,
    to: t[0],
    token: t[1],
    amount: t[2],
    proposedAt: Number(t[3]),
    confirmFrom: Number(t[4]),
    releaseAt: Number(t[5]),
    expiresAt: Number(t[6]),
    epoch: Number(t[7]),
    tier: Number(t[8]),
    status: Number(t[9]),
    confirmed: t[10],
    isPayee: since > 0n,
  };
}

export async function readView(cfg: Config, me: string, focus: bigint | null = null): Promise<View> {
  const v = cfg.vault;
  const now = Math.floor(Date.now() / 1000);
  const [ids, epoch, keyEpoch, frozenUntil, lastFreezer, myRole, changeCount] = await Promise.all([
    call<bigint[]>(v, "getPendingIds"),
    call<bigint>(v, "epoch"),
    call<bigint>(v, "keyEpoch"),
    call<bigint>(v, "frozenUntil"),
    call<string>(v, "lastFreezer"),
    call<bigint>(v, "roleOf", [me]),
    call<bigint>(v, "changeCount"),
  ]);
  const pending: Pay[] = await Promise.all([...ids].map((id) => readPayment(v, id)));
  const waiting = pending.filter((p) => p.status === STATUS.PENDING);
  const gone = focus !== null && !waiting.some((p) => p.id === focus) ? await readPayment(v, focus) : undefined;
  const changes: Chg[] = [];
  for (let id = changeCount; id >= 1n && id > changeCount - 12n; id--) {
    const t = (await call<ChangeTuple>(v, "getChange", [id])) as ChangeTuple;
    const c: Chg = {
      id,
      kind: Number(t[0]),
      data: t[1],
      proposedAt: Number(t[2]),
      readyAt: Number(t[3]),
      expiresAt: Number(t[4]),
      proposer: t[5],
      approver: t[6],
      keyEpoch: Number(t[7]),
      status: Number(t[8]),
      fields: null,
    };
    if (c.status !== STATUS.PENDING || c.keyEpoch !== Number(keyEpoch) || now > c.expiresAt) continue;
    try {
      c.fields = decodeChangeData(c.kind as ChangeKind, c.data);
    } catch {
      c.fields = null;
    }
    changes.push(c);
  }
  return {
    mode: "live",
    pending: waiting,
    changes,
    epoch: Number(epoch),
    keyEpoch: Number(keyEpoch),
    frozenUntil: Number(frozenUntil),
    lastFreezer,
    myRole: Number(myRole),
    checkedAt: now,
    error: null,
    gone,
  };
}

function split(sig: string): { r: string; s: string; sig: string } {
  const s = Signature.from(sig);
  return { r: s.r, s: s.s, sig };
}

export function liveActions(cfg: Config, wallet: Wallet, view: () => View): Actions {
  const ctx: DigestContext = { chainId: BigInt(CHAIN_ID), vault: cfg.vault };
  const vault = () => new Contract(cfg.vault, ABI, wallet.connect(new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true })));

  async function relay(path: string, body: Record<string, unknown>): Promise<string> {
    if (!cfg.relayer) throw new Error("no relayer");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(`${cfg.relayer}${path}`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", ...(cfg.relayerToken ? { authorization: `Bearer ${cfg.relayerToken}` } : {}) },
        body: JSON.stringify(body, (_, x) => (typeof x === "bigint" ? x.toString() : x)),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let why = text;
        try {
          why = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
          void 0;
        }
        throw new Error(`relayer ${res.status}${why ? `: ${why}` : ""}`);
      }
      const out = (await res.json()) as { tx?: string };
      return out.tx ?? "";
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(digest: string, path: string | null, body: Record<string, unknown>, direct: () => Promise<{ hash: string }>): Promise<Done> {
    const sig = await wallet.signMessage(getBytes(digest));
    let relayError = "";
    if (path) {
      try {
        const tx = await relay(path, { ...body, ...split(sig) });
        return { path: "relayer", tx };
      } catch (e) {
        relayError = (e as Error).name === "AbortError" ? "relayer did not answer in 5 s" : (e as Error).message;
      }
    }
    try {
      const tx = await direct();
      return { path: "direct", tx: tx.hash };
    } catch (e) {
      const x = e as { shortMessage?: string; message?: string };
      const own = x.shortMessage ?? x.message ?? "direct send failed";
      throw new Error(relayError ? `${relayError}; from this phone: ${own}` : own);
    }
  }

  const gas = { gasLimit: 900_000 };
  return {
    stop: (p: Pay) => send(vetoDigest(ctx, p.id), "/relay/veto", { paymentId: p.id }, () => vault().veto(p.id, "0x", gas)),
    approve: (p: Pay) => send(approveDigest(ctx, p.id), "/relay/approve", { paymentId: p.id }, () => vault().approve(p.id, "0x", { gasLimit: 3_000_000 })),
    freeze: () => {
      const epoch = BigInt(view().epoch);
      return send(freezeDigest(ctx, epoch), "/relay/freeze", { epoch }, () => vault().freeze("0x", { gasLimit: 3_000_000 }));
    },
    renewFreeze: () => {
      const v = view();
      return send(renewFreezeDigest(ctx, BigInt(v.epoch), BigInt(v.frozenUntil)), null, {}, () => vault().renewFreeze("0x", gas));
    },
    approveChange: (c: Chg) =>
      send(changeApproveDigest(ctx, c.id, c.kind as ChangeKind, c.data), `/relay/change/${c.id}/approve`, {}, () => vault().approveChange(c.id, "0x", gas)),
    stopChange: (c: Chg) => send(changeVetoDigest(ctx, c.id), `/relay/change/${c.id}/veto`, {}, () => vault().vetoChange(c.id, "0x", gas)),
  };
}
