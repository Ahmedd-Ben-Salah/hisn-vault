import { EventEmitter } from "node:events";
import { getAddress, isAddress, TransactionReceipt } from "ethers";
import {
  type DigestContext,
  type RequestView,
  type PaymentView,
  type ChangeView,
  type ChangeFields,
  ChangeKind,
  CHANGE_KIND_NAMES,
  HBAR,
  TIER_NAMES,
  payDigest,
  vetoDigest,
  approveDigest,
  freezeDigest,
  renewFreezeDigest,
  reconfirmDigest,
  cancelDigest,
  alertAckDigest,
  changeDigest,
  changeApproveDigest,
  changeVetoDigest,
  decodeChangeData,
  encodeChangeData,
  USDC_TOKEN_ID,
  evmAddressToEntityId,
  decodePqSignature,
  pqVerify,
  type PqSignature,
} from "./shared.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { RelayError, vaultInterface, type VaultClient } from "./chain/vault.js";
import type { ChainEvent } from "./chain/events.js";
import type { Indexer } from "./indexer.js";
import type { HcsLog } from "./hcs.js";
import type { Device, DeviceHub, DeviceMsg } from "./devices.js";
import { finishSignature, type SigInput } from "./sig.js";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface ChangeRequest {
  reqId: number;
  kind: string;
  fields: Record<string, string>;
  data: string;
  label?: string;
  status: "waiting_puck" | "rejected" | "proposed" | "failed";
  changeId?: number;
  reason?: string;
}

export interface PaymentRequestInput {
  to: string;
  token: string;
  amount: string;
  source: "dashboard" | "agent";
  note?: string;
}

function big(v: unknown, what: string): bigint {
  try {
    const b = BigInt(String(v));
    if (b < 0n) throw new Error();
    return b;
  } catch {
    throw new HttpError(400, `bad ${what}`);
  }
}

function idOf(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "bad id");
  return n;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function changeFieldsFrom(kind: ChangeKind, f: Record<string, unknown>): ChangeFields {
  const addr = (k: string) => {
    const v = String(f[k] ?? "");
    if (!isAddress(v)) throw new HttpError(400, `bad ${k}`);
    return getAddress(v);
  };
  switch (kind) {
    case ChangeKind.UNFREEZE:
      return { kind };
    case ChangeKind.SET_COOLOFF:
      return { kind, seconds: big(f.seconds, "seconds") };
    case ChangeKind.SET_LIMITS:
      return {
        kind,
        token: addr("token"),
        instantMax: big(f.instantMax, "instantMax"),
        waitMax: big(f.waitMax, "waitMax"),
        dailyCap: big(f.dailyCap, "dailyCap"),
        agentDailyMax: big(f.agentDailyMax, "agentDailyMax"),
      };
    default:
      return { kind, address: addr("address") } as ChangeFields;
  }
}

export type PreviewReason = "new_recipient" | "on_probation" | "over_instant_max" | "over_daily_cap" | "over_half_balance" | "over_wait_max" | "saved_small";

export interface PreviewInput {
  amount: bigint;
  since: number; // payeeSince, 0 if never added
  probation: number;
  now: number;
  instantMax: bigint;
  waitMax: bigint;
  dailyCap: bigint;
  instantUsed: bigint; // instant spent in the current window
  waitUsed: bigint; // wait queued in the current window
  spendable: bigint;
}

/** Mirrors HisnVault.tierFor and explains which rule applied. */
export function previewReasons(i: PreviewInput): PreviewReason[] {
  const reasons: PreviewReason[] = [];
  const saved = i.since !== 0 && i.now >= i.since + i.probation;
  if (i.since === 0) reasons.push("new_recipient");
  else if (!saved) reasons.push("on_probation");
  if (saved && i.amount <= i.instantMax && i.instantUsed + i.amount <= i.dailyCap) {
    reasons.push("saved_small");
    return reasons;
  }
  if (saved) {
    if (i.amount > i.instantMax) reasons.push("over_instant_max");
    else if (i.instantUsed + i.amount > i.dailyCap) reasons.push("over_daily_cap");
  }
  if (!saved && i.amount * 2n > i.spendable) {
    reasons.push("over_half_balance");
    return reasons;
  }
  if (i.waitUsed + i.amount > i.waitMax) reasons.push("over_wait_max");
  return reasons;
}

export type GuardianFact = "never_paid" | "times_usual" | "own_device" | "nth_this_week";

/** Fact codes for a guardian alert, from indexed chain data only. */
export function guardianFacts(p: PaymentView, all: Iterable<PaymentView>, nowSec: number): { facts: GuardianFact[]; timesUsual: number | null; weekCount: number } {
  const facts: GuardianFact[] = [];
  const others = [...all].filter((x) => x.id !== p.id);
  if (!others.some((x) => x.status === "EXECUTED" && x.to.toLowerCase() === p.to.toLowerCase())) facts.push("never_paid");
  const past = others
    .filter((x) => x.status === "EXECUTED" && x.token.toLowerCase() === p.token.toLowerCase())
    .sort((a, b) => b.proposedAt - a.proposedAt)
    .slice(0, 10)
    .map((x) => BigInt(x.amount))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let timesUsual: number | null = null;
  if (past.length > 0) {
    const mid = past.length >> 1;
    const median = past.length % 2 ? past[mid] : (past[mid - 1] + past[mid]) / 2n;
    if (median > 0n) {
      timesUsual = Number((BigInt(p.amount) * 10n) / median) / 10;
      if (BigInt(p.amount) >= median * 2n) facts.push("times_usual");
    }
  }
  // A payment record only exists through propose(), which the vault accepts only with the puck's signature
  // (agentPay never creates one), so a proposed payment was signed on the owner's own device.
  if (p.txs.proposed || p.proposedAt > 0) facts.push("own_device");
  const weekAgo = nowSec - 7 * 86400;
  const weekCount = [...others, p].filter((x) => x.proposedAt >= weekAgo).length;
  if (weekCount >= 2) facts.push("nth_this_week");
  return { facts, timesUsual, weekCount };
}

export class Flows extends EventEmitter {
  private ctx: DigestContext;
  private timeouts = new Map<number, NodeJS.Timeout>();
  private reconfirmTimers = new Map<number, NodeJS.Timeout>();
  private changeReqs = new Map<number, ChangeRequest>();
  private changeSeq = 0;
  private alerted = new Set<number>();
  private changeAlerted = new Set<number>();

  constructor(
    private cfg: Config,
    private db: Db,
    private vault: VaultClient,
    private idx: Indexer,
    private hcs: HcsLog,
    private hub: DeviceHub,
  ) {
    super();
    this.ctx = { chainId: cfg.chainId, vault: cfg.vault };
    hub.on("hello", (d: Device) => this.onHello(d));
    hub.on("message", (d: Device, m: DeviceMsg) => void this.onDevice(d, m).catch((e) => this.deviceError(d, m, e)));
    idx.on("event", (e: ChainEvent) => this.onChainEvent(e));
    idx.on("payment", (p: PaymentView) => this.onPayment(p));
    idx.on("change", (c: ChangeView) => this.onChange(c));
  }

  private key(k: string): string {
    return `${this.cfg.vault.toLowerCase()}:${k}`;
  }

  private keepers(): string[] {
    return [...this.idx.roles.guardians, ...this.idx.roles.watchers];
  }

  private finish(digest: string, input: SigInput, candidates: string[]) {
    const f = finishSignature(digest, input, candidates);
    if (!f) throw new HttpError(400, "signature does not match an allowed key");
    return f;
  }

  private async submit(method: string, args: unknown[]) {
    try {
      return await this.vault.submit(method, args);
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
  }

  private findLog(receipt: TransactionReceipt, name: string) {
    for (const l of receipt.logs) {
      try {
        const d = vaultInterface.parseLog({ topics: [...l.topics], data: l.data });
        if (d?.name === name) return d;
      } catch {
        continue;
      }
    }
    return null;
  }

  private emitRequest(r: RequestView): void {
    this.db.saveRequest(r);
    this.emit("request", r);
  }

  async tierPreview(to: string, token: string, amount: bigint): Promise<string> {
    const t = await this.vault.read.tierFor(to, token, amount);
    return TIER_NAMES[Number(t)];
  }

  async preview(to: string, token: string, amount: bigint): Promise<{ tier: string; reasons: PreviewReason[] }> {
    if (!isAddress(to)) throw new HttpError(400, "bad recipient address");
    if (!isAddress(token)) throw new HttpError(400, "bad token");
    const r = this.vault.read;
    const [tier, lim, win, spendable, probation, since] = await Promise.all([
      this.tierPreview(to, token, amount),
      r.limits(token),
      r.windows(token),
      r.spendable(token),
      r.PROBATION(),
      r.payeeSince(to).catch(() => {
        const p = this.idx.state?.payees.find((x) => x.address.toLowerCase() === to.toLowerCase());
        return p ? BigInt(p.since) : 0n;
      }),
    ]);
    const reasons = previewReasons({
      amount,
      since: Number(since),
      probation: Number(probation),
      now: now(),
      instantMax: BigInt(lim.instantMax),
      waitMax: BigInt(lim.waitMax),
      dailyCap: BigInt(lim.dailyCap),
      instantUsed: BigInt(win.instant2d ?? win[0]),
      waitUsed: BigInt(win.wait2d ?? win[1]),
      spendable: BigInt(spendable),
    });
    return { tier, reasons };
  }

  /**
   * The puck's hash-based (post-quantum) signature, if the vault needs one. Checked off-chain first so a bad
   * signature gives a clear error instead of a failed transaction. Returns the bytes to pass, or null for
   * a classical-only vault.
   */
  private async pqFor(digest: string, pq: unknown): Promise<string | null> {
    // The cached state may not be loaded yet (relayer just started): then ask the vault directly.
    let root = this.idx.state?.pq ? this.idx.state.pq.root : null;
    if (!this.idx.state?.pq) {
      try {
        const r = String(await this.vault.read.pqRoot());
        root = /^0x0+$/.test(r) ? null : r;
      } catch {
        root = null; // a vault deployed before the PQ layer has no pqRoot()
      }
    }
    if (!root) return null;
    if (typeof pq !== "string" || !/^0x[0-9a-fA-F]+$/.test(pq)) {
      throw new HttpError(400, "This account needs the puck's quantum-safe signature. Update the puck.");
    }
    let sig: PqSignature;
    try {
      sig = decodePqSignature(pq);
    } catch {
      throw new HttpError(400, "The quantum-safe signature does not decode.");
    }
    if (!pqVerify(this.ctx, digest, sig, root)) throw new HttpError(400, "The quantum-safe signature does not match the puck's keys.");
    return pq;
  }

  /** Ask the online puck(s) to sign a CANCEL for a pending payment. The owner still confirms on the puck. */
  requestStop(paymentId: number): { sent: number } {
    const p = this.idx.payments.get(paymentId);
    if (!p) throw new HttpError(404, "no such payment");
    if (p.status !== "PENDING") throw new HttpError(409, "the payment is not pending");
    // The puck shows what it is stopping, from these fields, before the owner enters the PIN.
    const sent = this.hub.toRole("puck", { t: "cancel_request", type: "cancel_request", paymentId, to: p.to, token: p.token, amount: p.amount });
    if (sent === 0) throw new HttpError(503, "no puck is online");
    return { sent };
  }

  /** Ask the online puck(s) to freeze the account. The owner still confirms on the puck. */
  requestFreeze(): { sent: number } {
    const sent = this.hub.toRole("puck", { t: "freeze_request", type: "freeze_request" });
    if (sent === 0) throw new HttpError(503, "no puck is online");
    return { sent };
  }

  private async recipientCanTakeUsdc(to: string): Promise<string | null> {
    if (this.cfg.mode !== "testnet") return null;
    try {
      const acc = await fetch(`${this.cfg.mirrorUrl}/api/v1/accounts/${to}`);
      if (acc.status === 404) return null;
      if (!acc.ok) return null;
      const a = (await acc.json()) as { max_automatic_token_associations?: number; account?: string };
      if (a.max_automatic_token_associations === -1 || (a.max_automatic_token_associations ?? 0) > 0) return null;
      const t = await fetch(`${this.cfg.mirrorUrl}/api/v1/accounts/${a.account ?? to}/tokens?token.id=${evmAddressToEntityId(this.cfg.usdc) ?? USDC_TOKEN_ID}`);
      if (!t.ok) return null;
      const body = (await t.json()) as { tokens?: unknown[] };
      return body.tokens && body.tokens.length > 0 ? null : "The recipient's Hedera account cannot receive USDC yet (token not associated).";
    } catch {
      return null;
    }
  }

  async createRequest(input: PaymentRequestInput): Promise<RequestView & { tier: string }> {
    if (!isAddress(input.to)) throw new HttpError(400, "bad recipient address");
    const to = getAddress(input.to);
    if (!isAddress(input.token)) throw new HttpError(400, "bad token");
    const token = getAddress(input.token);
    if (token !== getAddress(HBAR) && token !== this.cfg.usdc) throw new HttpError(400, "token must be HBAR or USDC");
    const amount = big(input.amount, "amount");
    if (amount === 0n) throw new HttpError(400, "amount must be above zero");
    if (input.source !== "dashboard" && input.source !== "agent") throw new HttpError(400, "bad source");
    if (this.db.openRequest(this.cfg.vault, input.source)) throw new HttpError(409, "a request from this source is already waiting for the puck");
    if (this.idx.state?.frozen) throw new HttpError(409, "the account is frozen");
    if (token === this.cfg.usdc) {
      const why = await this.recipientCanTakeUsdc(to);
      if (why) throw new HttpError(422, why);
    }
    const tier = await this.tierPreview(to, token, amount);
    const r = this.db.createRequest(this.cfg.vault, {
      to,
      token,
      amount: amount.toString(),
      source: input.source,
      status: "waiting_puck",
      note: input.note,
    });
    this.emit("request", r);
    this.hcs.publish(this.key(`req:${r.reqId}`), { type: "REQUEST", ref: 0, body: { reqId: r.reqId, to, token, amount: r.amount, source: r.source } });
    this.pushRequest(r);
    this.timeouts.set(
      r.reqId,
      setTimeout(() => {
        const cur = this.db.getRequest(r.reqId);
        if (cur && cur.status === "waiting_puck") this.emitRequest({ ...cur, status: "failed", reason: "The puck did not answer in time." });
      }, this.cfg.requestTimeoutMs),
    );
    return { ...r, tier };
  }

  private pushRequest(r: RequestView): void {
    this.hub.toRole("puck", { t: "request", reqId: r.reqId, to: r.to, token: r.token, amount: r.amount, source: r.source });
  }

  getRequest(reqId: number): RequestView {
    const r = this.db.getRequest(reqId);
    if (!r) throw new HttpError(404, "no such request");
    return r;
  }

  private onHello(d: Device): void {
    if (d.role === "puck") {
      for (const r of this.db.listRequests(this.cfg.vault, 20)) if (r.status === "waiting_puck") this.pushRequest(r);
      for (const c of this.changeReqs.values()) if (c.status === "waiting_puck") this.pushChange(c);
      const t = now();
      for (const p of this.idx.payments.values()) {
        if (p.status === "PENDING" && p.tier === "WAIT" && !p.confirmed && t >= p.confirmFrom) this.sendReconfirm(p);
      }
      for (const c of this.idx.changes.values()) {
        if (c.status === "PENDING" && c.kind === "RECOVER_PUCK") this.hub.send(d, { t: "recovery_alert", changeId: c.id, newPuck: c.fields.address });
      }
      const pq = this.idx.state?.pq;
      this.hub.send(d, {
        t: "state",
        epoch: this.idx.state?.epoch ?? 0,
        keyEpoch: this.idx.state?.keyEpoch ?? 0,
        frozen: this.idx.state?.frozen ?? false,
        pqRoot: pq?.root ?? null,
        pqUsed: pq?.used ?? 0,
      });
    } else {
      for (const p of this.idx.payments.values()) if (p.status === "PENDING") this.hub.send(d, this.alertMsg(p));
      for (const c of this.idx.changes.values()) if (c.status === "PENDING") this.hub.send(d, { t: "change_alert", changeId: c.id, kind: CHANGE_KIND_NAMES.indexOf(c.kind) });
      this.hub.send(d, { t: "state", epoch: this.idx.state?.epoch ?? 0, frozen: this.idx.state?.frozen ?? false });
    }
  }

  private isCurrentPuck(d: Device): boolean {
    const puck = this.idx.roles?.puck;
    if (!d.address || !puck) return false;
    try {
      return getAddress(d.address) === getAddress(puck);
    } catch {
      return false;
    }
  }

  private deviceError(d: Device, m: DeviceMsg, e: unknown): void {
    const reason = (e as Error).message;
    console.error(`device ${d.id} ${m.t}: ${reason}`);
    this.hub.send(d, { t: "error", for: m.t, reason, reqId: m.reqId, paymentId: m.paymentId, changeId: m.changeId });
  }

  private async onDevice(d: Device, m: DeviceMsg): Promise<void> {
    switch (m.t) {
      case "signed":
        if (d.role !== "puck") return;
        await this.onPuckSigned(d, m);
        return;
      case "rejected": {
        // Only the device that said hello with the vault's current puck address may reject.
        if (d.role !== "puck" || !this.isCurrentPuck(d)) return;
        if (m.change) {
          const c = this.changeReqs.get(Number(m.reqId));
          if (c && c.status === "waiting_puck") this.setChangeReq({ ...c, status: "rejected", reason: "The owner said no on the puck." });
          return;
        }
        const r = this.db.getRequest(Number(m.reqId));
        if (r && r.status === "waiting_puck") {
          clearTimeout(this.timeouts.get(r.reqId));
          this.emitRequest({ ...r, status: "rejected", reason: "The owner said no on the puck." });
        }
        return;
      }
      case "reconfirmed": {
        const tx = await this.reconfirm({ paymentId: m.paymentId, nonce: m.nonce, deadline: m.deadline, r: m.r as string, s: m.s as string, pq: m.pq });
        this.hub.send(d, { t: "result", paymentId: Number(m.paymentId), ok: true, tx, what: "reconfirm" });
        return;
      }
      case "cancel": {
        const tx = await this.cancel({ paymentId: m.paymentId, r: m.r as string, s: m.s as string });
        this.hub.send(d, { t: "result", paymentId: Number(m.paymentId), ok: true, tx, what: "cancel" });
        return;
      }
      case "change_signed": {
        const c = this.changeReqs.get(Number(m.reqId));
        if (!c || c.status !== "waiting_puck") return;
        try {
          const out = await this.proposeChange({ kind: CHANGE_KIND_NAMES.indexOf(c.kind as (typeof CHANGE_KIND_NAMES)[number]), data: c.data, nonce: m.nonce, deadline: m.deadline, r: m.r as string, s: m.s as string, pq: m.pq });
          this.setChangeReq({ ...c, status: "proposed", changeId: out.changeId });
          this.hub.send(d, { t: "result", reqId: c.reqId, ok: true, changeId: out.changeId, what: "change" });
        } catch (e) {
          this.setChangeReq({ ...c, status: "failed", reason: (e as Error).message });
          throw e;
        }
        return;
      }
      case "ack":
        this.onAck(d, m);
        return;
      case "veto": {
        const tx = await this.veto({ paymentId: m.paymentId, r: m.r as string, s: m.s as string, sig: m.sig as string });
        this.hub.send(d, { t: "result", paymentId: Number(m.paymentId), ok: true, tx, what: "veto" });
        return;
      }
      case "change_veto": {
        const tx = await this.vetoChange(idOf(m.changeId), { r: m.r as string, s: m.s as string, sig: m.sig as string });
        this.hub.send(d, { t: "result", changeId: Number(m.changeId), ok: true, tx, what: "change_veto" });
        return;
      }
      case "freeze": {
        const tx = await this.freeze({ epoch: m.epoch, r: m.r as string, s: m.s as string, sig: m.sig as string });
        this.hub.send(d, { t: "result", ok: true, tx, what: "freeze" });
        return;
      }
      default:
        return;
    }
  }

  private async onPuckSigned(d: Device, m: DeviceMsg): Promise<void> {
    const r = this.db.getRequest(Number(m.reqId));
    if (!r || r.status !== "waiting_puck") return;
    clearTimeout(this.timeouts.get(r.reqId));
    const fields = { to: r.to, token: r.token, amount: BigInt(r.amount), nonce: big(m.nonce, "nonce"), deadline: big(m.deadline, "deadline") };
    const digest = payDigest(this.ctx, fields);
    const f = finishSignature(digest, { r: m.r as string, s: m.s as string, sig: m.sig as string }, [this.idx.roles.puck]);
    if (!f) {
      this.emitRequest({ ...r, status: "failed", reason: "The puck's signature did not match the vault's puck key." });
      this.hub.send(d, { t: "result", reqId: r.reqId, ok: false, error: "BadSignature" });
      return;
    }
    const body = { to: r.to, token: r.token, amount: r.amount, nonce: fields.nonce.toString(), deadline: fields.deadline.toString() };
    this.hcs.publish(this.key(`paysig:${r.reqId}`), { type: "PAY_SIGNED", ref: 0, body: { reqId: r.reqId, ...body }, signer: f.signer, sig: f.sig });
    try {
      const pq = await this.pqFor(digest, m.pq);
      const sent = pq
        ? await this.vault.submit("proposePQ", [r.to, r.token, fields.amount, fields.nonce, fields.deadline, f.sig, pq])
        : await this.vault.submit("propose", [r.to, r.token, fields.amount, fields.nonce, fields.deadline, f.sig]);
      const receipt = await sent.receipt;
      const ev = this.findLog(receipt, "Proposed");
      const paymentId = ev ? Number(ev.args.id) : undefined;
      const tier = ev ? TIER_NAMES[Number(ev.args.tier)] : undefined;
      const releaseAt = ev ? Number(ev.args.releaseAt) : undefined;
      this.emitRequest({ ...r, status: "proposed", paymentId });
      this.hub.send(d, { t: "result", reqId: r.reqId, ok: true, paymentId, tier, releaseAt });
      void this.idx.tick();
    } catch (e) {
      const reason = (e as Error).message;
      this.emitRequest({ ...r, status: "failed", reason });
      this.hub.send(d, { t: "result", reqId: r.reqId, ok: false, error: reason });
    }
  }

  private onAck(d: Device, m: DeviceMsg): void {
    const paymentId = idOf(m.paymentId);
    const nonce = big(m.nonce ?? 0, "nonce");
    const f = finishSignature(alertAckDigest(this.ctx, BigInt(paymentId), nonce), { r: m.r as string, s: m.s as string, sig: m.sig as string }, this.keepers());
    if (!f) return;
    this.hcs.publish(this.key(`ack:${paymentId}:${f.signer}`), { type: "ALERT_ACK", ref: paymentId, body: { paymentId, nonce: nonce.toString() }, signer: f.signer, sig: f.sig });
    this.emit("ack", { paymentId, signer: f.signer, device: d.id });
  }

  async veto(b: { paymentId: unknown } & SigInput): Promise<string> {
    const id = idOf(b.paymentId);
    const f = this.finish(vetoDigest(this.ctx, BigInt(id)), b, this.keepers());
    const sent = await this.submit("veto", [id, f.sig]);
    this.hcs.publish(this.key(`vetosig:${id}:${f.signer}`), { type: "VETO_SIGNED", ref: id, body: { paymentId: id }, signer: f.signer, sig: f.sig, tx: sent.hash });
    return sent.hash;
  }

  async approve(b: { paymentId: unknown } & SigInput): Promise<string> {
    const id = idOf(b.paymentId);
    const f = this.finish(approveDigest(this.ctx, BigInt(id)), b, this.idx.roles.guardians);
    const sent = await this.submit("approve", [id, f.sig]);
    this.hcs.publish(this.key(`approvesig:${id}`), { type: "APPROVE_SIGNED", ref: id, body: { paymentId: id }, signer: f.signer, sig: f.sig, tx: sent.hash });
    return sent.hash;
  }

  async reconfirm(b: { paymentId: unknown; nonce: unknown; deadline: unknown; pq?: unknown } & SigInput): Promise<string> {
    const id = idOf(b.paymentId);
    const nonce = big(b.nonce, "nonce");
    const deadline = big(b.deadline, "deadline");
    const digest = reconfirmDigest(this.ctx, BigInt(id), nonce, deadline);
    const f = this.finish(digest, b, [this.idx.roles.puck]);
    const pq = await this.pqFor(digest, b.pq);
    const sent = pq ? await this.submit("reconfirmPQ", [id, nonce, deadline, f.sig, pq]) : await this.submit("reconfirm", [id, nonce, deadline, f.sig]);
    this.hcs.publish(this.key(`reconfirmsig:${id}`), {
      type: "RECONFIRM_SIGNED",
      ref: id,
      body: { paymentId: id, nonce: nonce.toString(), deadline: deadline.toString() },
      signer: f.signer,
      sig: f.sig,
      tx: sent.hash,
    });
    return sent.hash;
  }

  async cancel(b: { paymentId: unknown } & SigInput): Promise<string> {
    const id = idOf(b.paymentId);
    const f = this.finish(cancelDigest(this.ctx, BigInt(id)), b, [this.idx.roles.puck]);
    const sent = await this.submit("cancel", [id, f.sig]);
    return sent.hash;
  }

  async freeze(b: { epoch: unknown } & SigInput): Promise<string> {
    const epoch = big(b.epoch, "epoch");
    const f = this.finish(freezeDigest(this.ctx, epoch), b, [this.idx.roles.puck, ...this.keepers()]);
    const sent = await this.submit("freeze", [f.sig]);
    this.hcs.publish(this.key(`frozen:${epoch + 1n}`), { type: "FROZEN", ref: 0, body: { epoch: epoch.toString() }, signer: f.signer, sig: f.sig, tx: sent.hash });
    return sent.hash;
  }

  async renewFreeze(b: SigInput): Promise<string> {
    const s = this.idx.state;
    if (!s) throw new HttpError(503, "state not loaded");
    const f = this.finish(renewFreezeDigest(this.ctx, BigInt(s.epoch), BigInt(s.frozenUntil)), b, [this.idx.roles.puck, ...this.keepers()]);
    return (await this.submit("renewFreeze", [f.sig])).hash;
  }

  async proposeChange(b: { kind: unknown; data: unknown; nonce: unknown; deadline: unknown; pq?: unknown } & SigInput): Promise<{ changeId: number | undefined; tx: string }> {
    const kind = Number(b.kind);
    if (!Number.isInteger(kind) || kind < 0 || kind >= CHANGE_KIND_NAMES.length) throw new HttpError(400, "bad kind");
    const data = String(b.data ?? "0x");
    let fields: ChangeFields;
    try {
      fields = decodeChangeData(kind as ChangeKind, data);
    } catch {
      throw new HttpError(400, "data does not decode for this kind");
    }
    const nonce = big(b.nonce, "nonce");
    const deadline = big(b.deadline, "deadline");
    const keyEpoch = BigInt(await this.vault.read.keyEpoch());
    const candidates = kind === ChangeKind.RECOVER_PUCK ? this.idx.roles.guardians : [this.idx.roles.puck];
    const digest = changeDigest(this.ctx, fields, keyEpoch, nonce, deadline);
    const f = this.finish(digest, b, candidates);
    // Guardian-started recovery has no puck, so no hash-based signature (see docs/QUANTUM.md, "What stays classical").
    const pq = kind === ChangeKind.RECOVER_PUCK ? null : await this.pqFor(digest, b.pq);
    const sent = pq
      ? await this.submit("proposeChangePQ", [kind, data, nonce, deadline, f.sig, pq])
      : await this.submit("proposeChange", [kind, data, nonce, deadline, f.sig]);
    let changeId: number | undefined;
    try {
      const ev = this.findLog(await sent.receipt, "ChangeProposed");
      changeId = ev ? Number(ev.args.id) : undefined;
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
    this.hcs.publish(this.key(`changesig:${changeId ?? sent.hash}`), {
      type: "CHANGE_SIGNED",
      ref: changeId ?? 0,
      body: { kind, data, keyEpoch: keyEpoch.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
      signer: f.signer,
      sig: f.sig,
      tx: sent.hash,
    });
    void this.idx.tick();
    return { changeId, tx: sent.hash };
  }

  private async rawChange(id: number): Promise<{ kind: number; data: string }> {
    const known = this.idx.rawChange(id);
    if (known) return known;
    const c = await this.vault.read.getChange(id);
    if (Number(c.status) === 0) throw new HttpError(404, "no such change");
    return { kind: Number(c.kind), data: String(c.data) };
  }

  async approveChange(id: number, b: SigInput): Promise<string> {
    const c = await this.rawChange(id);
    const f = this.finish(changeApproveDigest(this.ctx, BigInt(id), c.kind as ChangeKind, c.data), b, this.idx.roles.guardians);
    const sent = await this.submit("approveChange", [id, f.sig]);
    this.hcs.publish(this.key(`changeapprove:${id}:${f.signer}`), { type: "CHANGE_APPROVED", ref: id, body: { kind: c.kind, data: c.data }, signer: f.signer, sig: f.sig, tx: sent.hash });
    return sent.hash;
  }

  async vetoChange(id: number, b: SigInput): Promise<string> {
    const f = this.finish(changeVetoDigest(this.ctx, BigInt(id)), b, [this.idx.roles.puck, ...this.keepers()]);
    const sent = await this.submit("vetoChange", [id, f.sig]);
    this.hcs.publish(this.key(`changeveto:${id}:${f.signer}`), { type: "CHANGE_VETOED", ref: id, body: { changeId: id }, signer: f.signer, sig: f.sig, tx: sent.hash });
    return sent.hash;
  }

  async executeChange(id: number): Promise<string> {
    const c = this.idx.changes.get(id);
    if (!c) throw new HttpError(404, "no such change");
    if (c.status !== "PENDING") throw new HttpError(409, `change is ${c.status}`);
    return (await this.submit("executeChange", [id])).hash;
  }

  async fallbackExecute(id: number): Promise<string> {
    const p = this.idx.payments.get(id) ?? (await this.idx.refreshPayment(id));
    if (p.status !== "PENDING") throw new HttpError(409, `payment is ${p.status}`);
    if (!p.confirmed) throw new HttpError(409, "payment is not confirmed yet");
    const late = now() > p.releaseAt + 30;
    if (!late && !this.idx.hasScheduleFailed(id)) throw new HttpError(409, "the network timer is still in charge; manual release opens 30 s after the release time");
    return (await this.submit("execute", [id])).hash;
  }

  requestChange(kindName: string, fieldsIn: Record<string, unknown>): ChangeRequest {
    const kind = CHANGE_KIND_NAMES.indexOf(kindName as (typeof CHANGE_KIND_NAMES)[number]);
    if (kind < 0) throw new HttpError(400, "bad kind");
    if ([...this.changeReqs.values()].some((c) => c.status === "waiting_puck")) throw new HttpError(409, "a change is already waiting for the puck");
    const fields = changeFieldsFrom(kind as ChangeKind, fieldsIn);
    const data = encodeChangeData(fields);
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) if (k !== "kind") flat[k] = String(v);
    const label = typeof fieldsIn.label === "string" ? fieldsIn.label.replace(/[^\x20-\x7e]/g, "").slice(0, 16) : undefined;
    const c: ChangeRequest = { reqId: ++this.changeSeq, kind: kindName, fields: flat, data, label, status: "waiting_puck" };
    this.setChangeReq(c);
    this.pushChange(c);
    setTimeout(() => {
      const cur = this.changeReqs.get(c.reqId);
      if (cur && cur.status === "waiting_puck") this.setChangeReq({ ...cur, status: "failed", reason: "The puck did not answer in time." });
    }, this.cfg.requestTimeoutMs);
    return c;
  }

  private pushChange(c: ChangeRequest): void {
    this.hub.toRole("puck", {
      t: "change",
      reqId: c.reqId,
      kind: CHANGE_KIND_NAMES.indexOf(c.kind as (typeof CHANGE_KIND_NAMES)[number]),
      kindName: c.kind,
      fields: c.fields,
      data: c.data,
      label: c.label ?? "",
      keyEpoch: this.idx.state?.keyEpoch ?? 0,
    });
  }

  private setChangeReq(c: ChangeRequest): void {
    this.changeReqs.set(c.reqId, c);
    this.emit("changeRequest", c);
  }

  getChangeRequest(reqId: number): ChangeRequest {
    const c = this.changeReqs.get(reqId);
    if (!c) throw new HttpError(404, "no such change request");
    return c;
  }

  private alertMsg(p: PaymentView): Record<string, unknown> {
    return { t: "alert", paymentId: p.id, tier: p.tier, amount: p.amount, token: p.token, to: p.to, releaseAt: p.releaseAt, newRecipient: p.newRecipient, ...guardianFacts(p, this.idx.payments.values(), now()) };
  }

  private sendReconfirm(p: PaymentView): void {
    this.hub.toRole("puck", { t: "reconfirm", paymentId: p.id, to: p.to, token: p.token, amount: p.amount, releaseAt: p.releaseAt, confirmFrom: p.confirmFrom });
  }

  private onPayment(p: PaymentView): void {
    if (p.status === "PENDING") {
      if (!this.alerted.has(p.id)) {
        this.alerted.add(p.id);
        this.hub.toRole("guardian", this.alertMsg(p));
      }
      if (p.tier === "WAIT" && !p.confirmed && !this.reconfirmTimers.has(p.id)) {
        const wait = Math.max(0, p.confirmFrom - now()) * 1000 + 1500;
        this.reconfirmTimers.set(
          p.id,
          setTimeout(() => {
            const cur = this.idx.payments.get(p.id);
            if (cur && cur.status === "PENDING" && !cur.confirmed) this.sendReconfirm(cur);
          }, wait),
        );
      }
      return;
    }
    clearTimeout(this.reconfirmTimers.get(p.id));
    if (this.alerted.has(p.id)) {
      this.alerted.delete(p.id);
      this.hub.toRole("guardian", { t: "clear", paymentId: p.id, why: p.status });
      this.hub.toRole("puck", { t: "stopped", paymentId: p.id, why: p.status, by: p.executedBy ?? null });
    }
  }

  private onChange(c: ChangeView): void {
    const kind = CHANGE_KIND_NAMES.indexOf(c.kind);
    if (c.status === "PENDING") {
      if (!this.changeAlerted.has(c.id)) {
        this.changeAlerted.add(c.id);
        this.hub.toRole("guardian", { t: "change_alert", changeId: c.id, kind });
        if (c.kind === "RECOVER_PUCK") this.hub.toRole("puck", { t: "recovery_alert", changeId: c.id, newPuck: c.fields.address });
      }
      return;
    }
    if (this.changeAlerted.has(c.id)) {
      this.changeAlerted.delete(c.id);
      this.hub.toRole("guardian", { t: "change_clear", changeId: c.id, why: c.status });
      if (c.status === "EXECUTED") this.hub.toRole("puck", { t: "change_applied", changeId: c.id, kind, kindName: c.kind, fields: c.fields });
    }
  }

  private onChainEvent(e: ChainEvent): void {
    const id = Number(e.args.id ?? 0);
    const tx = e.txHash;
    const k = (s: string) => this.key(`${s}:${e.key}`);
    switch (e.name) {
      case "Proposed":
        this.hcs.publish(k("proposed"), {
          type: "PROPOSED",
          ref: id,
          body: { to: String(e.args.to), token: String(e.args.token), amount: String(e.args.amount), tier: TIER_NAMES[Number(e.args.tier)], releaseAt: Number(e.args.releaseAt) },
          tx,
        });
        return;
      case "Confirmed": {
        const p = this.idx.payments.get(id);
        this.hcs.publish(k("confirmed"), { type: p?.tier === "APPROVAL" ? "APPROVED" : "CONFIRMED", ref: id, body: { by: String(e.args.by), schedule: String(e.args.schedule) }, tx });
        return;
      }
      case "Executed":
        this.hcs.publish(k("released"), { type: "RELEASED", ref: id, body: { caller: String(e.args.caller), to: String(e.args.to), amount: String(e.args.amount) }, tx });
        return;
      case "Vetoed":
        this.hcs.publish(k("vetoed"), { type: "VETOED", ref: id, body: { by: String(e.args.by) }, tx });
        return;
      case "Cancelled":
      case "Expired":
        this.hcs.publish(k("cancelled"), { type: "CANCELLED", ref: id, body: { why: e.name }, tx });
        return;
      case "ScheduleFailed":
        this.hcs.publish(k("schedfail"), { type: "SCHEDULE_FAILED", ref: id, body: {}, tx });
        return;
      case "Frozen":
        this.hcs.publish(this.key(`frozen:${e.args.newEpoch}`), { type: "FROZEN", ref: 0, body: { by: String(e.args.by), epoch: String(Number(e.args.newEpoch) - 1), until: Number(e.args.until) }, tx });
        return;
      case "AgentPaid":
        this.hcs.publish(k("agentpaid"), { type: "AGENT_PAID", ref: 0, body: { to: String(e.args.to), token: String(e.args.token), amount: String(e.args.amount) }, tx });
        return;
      case "ChangeExecuted":
        this.hcs.publish(k("changeapplied"), { type: "CHANGE_APPLIED", ref: id, body: { kind: Number(e.args.kind) }, tx });
        return;
      default:
        return;
    }
  }

  agentRefused(info: { to: string; token: string; amount: string; reason: string }): void {
    this.hcs.publish(this.key(`agentrefused:${Date.now()}:${info.to}`), { type: "AGENT_REFUSED", ref: 0, body: info });
  }

  isRelayError(e: unknown): e is RelayError {
    return e instanceof RelayError;
  }
}
