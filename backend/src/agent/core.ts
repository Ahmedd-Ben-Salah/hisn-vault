import { getAddress, getBytes, hexlify, isAddress, randomBytes } from "ethers";
import type { PaymentView, PayeeView, StateView } from "@hisn/shared";
import { HBAR, agentPayDigest, formatAmount, parseUnits } from "../shared.js";
import type { AgentHost } from "../agent-host.js";
import { findPayeeByLabel, redFlags } from "./intent.js";
import type { AgentAction, Symbol } from "./types.js";

export interface ToolOutcome {
  ok: boolean;
  code: string;
  text: string;
  reqId?: number;
  tx?: string;
}

const ROUTABLE = new Set(["NotPayee", "OnProbation", "OverAgentLimit", "RedFlags", "NoAgent"]);
const WEEK = 7 * 86400;

export function canRouteToPuck(code: string): boolean {
  return ROUTABLE.has(code);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function plainDuration(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} minutes`;
  return `${seconds} seconds`;
}

export function explainRefusal(code: string, probation = 0): string {
  switch (code) {
    case "NotPayee":
      return "I can only pay people you have saved in the vault, and this one is not saved.";
    case "OnProbation":
      return `This name was saved less than ${plainDuration(probation || 86400)} ago, so the vault will not let me pay it yet.`;
    case "OverAgentLimit":
      return "That is more than my allowance for today and yesterday together. The vault stops me, not my own code.";
    case "IsFrozen":
      return "The account is frozen, so nothing can be paid until the freeze ends.";
    case "NoAgent":
      return "No helper key is set up for this vault, so I cannot pay anything myself.";
    case "RedFlags":
      return "This request looks like how scams look, so I will not pay it myself.";
    case "BelowGasReserve":
      return "Paying this would dip into the HBAR kept aside for the network's release calls.";
    case "ZeroAmount":
      return "The amount has to be above zero.";
    case "BadToken":
      return "I can only pay in USDC or HBAR.";
    case "TransferFailed":
      return "The token transfer failed. The recipient may not be able to receive this token yet.";
    case "Replayed":
    case "BadSignature":
    case "Expired_":
    case "DeadlineTooFar":
      return "My signature was not accepted. Nothing was paid; please try again.";
    default:
      return `The vault refused the payment (${code}). Nothing was paid.`;
  }
}

function median(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)];
}

export function scamNote(input: {
  to: string;
  token: string;
  amount: bigint;
  now: number;
  payees: PayeeView[];
  probation: number;
  payments: PaymentView[];
}): string {
  const to = input.to.toLowerCase();
  const token = input.token.toLowerCase();
  const payee = input.payees.find((p) => p.address.toLowerCase() === to);
  const paid = input.payments.filter((p) => p.status === "EXECUTED" && p.token.toLowerCase() === token);
  const toThem = paid.filter((p) => p.to.toLowerCase() === to);
  const facts: string[] = [];
  if (!payee) facts.push("New recipient");
  else if (input.now < payee.since + input.probation) facts.push("Recipient saved recently");
  else facts.push("Saved recipient");
  if (toThem.length === 0) facts.push("first payment");
  const usual = median(paid.map((p) => BigInt(p.amount)));
  if (usual > 0n && input.amount >= usual * 2n) facts.push(`${(input.amount / usual).toString()}x your usual amount`);
  const thisWeek = input.payments.filter((p) => p.to.toLowerCase() === to && p.proposedAt >= input.now - WEEK).length;
  if (thisWeek > 0) facts.push(`${thisWeek} payment${thisWeek === 1 ? "" : "s"} to them this week`);
  if (facts.length === 1 && payee) facts.push("normal amount");
  return `${facts.join(", ")}.`;
}

export class AgentCore {
  actions: AgentAction[] = [];
  private ownerText = "";

  constructor(private readonly host: AgentHost) {}

  begin(ownerText: string): void {
    this.actions = [];
    this.ownerText = ownerText;
  }

  token(sym: Symbol): { address: string; decimals: number; symbol: Symbol } {
    return sym === "HBAR"
      ? { address: getAddress(HBAR), decimals: 8, symbol: "HBAR" }
      : { address: this.host.config.usdc, decimals: 6, symbol: "USDC" };
  }

  money(raw: bigint | string, sym: Symbol): string {
    return `${formatAmount(raw, this.token(sym).decimals, 2)} ${sym}`;
  }

  private symbolOf(token: string): Symbol {
    return token.toLowerCase() === this.host.config.usdc.toLowerCase() ? "USDC" : "HBAR";
  }

  private state(): StateView {
    const s = this.host.state();
    if (!s) throw new Error("the relayer has not read the vault yet");
    return s;
  }

  private async now(): Promise<number> {
    try {
      return await this.host.vault.now();
    } catch {
      return nowSec();
    }
  }

  async allowanceLeft(sym: Symbol): Promise<bigint> {
    const s = this.state();
    const max = BigInt(sym === "HBAR" ? s.limits.hbar.agentDailyMax : s.limits.usdc.agentDailyMax);
    let used = 0n;
    try {
      const w = await this.host.vault.read.windows(this.token(sym).address);
      used = BigInt(w[2]);
    } catch {
      used = 0n;
    }
    return max > used ? max - used : 0n;
  }

  ownerFlags(): string[] {
    return redFlags(this.ownerText);
  }

  async getState(): Promise<Record<string, unknown>> {
    const s = this.state();
    const now = await this.now();
    const probation = s.immutables.probation;
    return {
      balances: { USDC: this.money(s.balances.usdc, "USDC"), HBAR: this.money(s.balances.hbar, "HBAR") },
      gasReserve: this.money(s.gasReserve, "HBAR"),
      allowanceLeft: {
        USDC: this.money(await this.allowanceLeft("USDC"), "USDC"),
        HBAR: this.money(await this.allowanceLeft("HBAR"), "HBAR"),
      },
      allowanceRule: "The allowance counts today and yesterday together and is enforced by the vault.",
      frozen: s.frozen,
      helperKeySet: !!this.host.agentWallet && !!s.agent,
      payees: s.payees.map((p) => ({
        label: p.label ?? "(no name)",
        address: p.address,
        canPayNow: now >= p.since + probation,
        payableFrom: p.since + probation,
      })),
      pendingPayments: this.host
        .payments()
        .filter((p) => p.status === "PENDING")
        .map((p) => ({ id: p.id, to: p.label ?? p.to, amount: this.money(p.amount, this.symbolOf(p.token)), tier: p.tier })),
    };
  }

  private parse(amount: string, sym: Symbol): bigint | null {
    try {
      const raw = parseUnits(String(amount).trim(), this.token(sym).decimals);
      return raw > 0n ? raw : null;
    } catch {
      return null;
    }
  }

  private refuse(code: string, info: { payee: string | null; to: string | null; token: string; amount: bigint }): ToolOutcome {
    const s = this.host.state();
    const text = explainRefusal(code, s?.immutables.probation ?? 0);
    this.actions.push({ kind: "refused", at: nowSec(), payee: info.payee, to: info.to, token: info.token, amount: info.amount.toString(), reason: text });
    try {
      this.host.refused({ to: info.to ?? "", token: info.token, amount: info.amount.toString(), reason: code });
    } catch {
      void 0;
    }
    return { ok: false, code, text };
  }

  async paySmall(payeeLabel: string, sym: Symbol, amount: string): Promise<ToolOutcome> {
    const s = this.state();
    const token = this.token(sym);
    const raw = this.parse(amount, sym);
    if (raw === null) return { ok: false, code: "BadAmount", text: "The amount must be a positive number like 12 or 12.50." };
    const payee = findPayeeByLabel(payeeLabel, s.payees);
    const base = { payee: payee?.label ?? payeeLabel, to: payee?.address ?? null, token: token.address, amount: raw };
    if (this.ownerFlags().length > 0) return this.refuse("RedFlags", base);
    if (!payee) return this.refuse("NotPayee", base);
    if (s.frozen) return this.refuse("IsFrozen", base);
    const wallet = this.host.agentWallet;
    if (!wallet || !s.agent || getAddress(s.agent) !== getAddress(wallet.address)) return this.refuse("NoAgent", base);
    const now = await this.now();
    if (now < payee.since + s.immutables.probation) return this.refuse("OnProbation", base);
    if (raw > (await this.allowanceLeft(sym))) return this.refuse("OverAgentLimit", base);
    const nonce = BigInt(hexlify(randomBytes(16)));
    const deadline = BigInt(now + 300);
    const digest = agentPayDigest(
      { chainId: this.host.config.chainId, vault: this.host.config.vault },
      { to: payee.address, token: token.address, amount: raw, nonce, deadline },
    );
    const sig = await wallet.signMessage(getBytes(digest));
    try {
      const { hash } = await this.host.vault.send("agentPay", [payee.address, token.address, raw, nonce, deadline, sig]);
      this.actions.push({ kind: "paid", at: nowSec(), payee: payee.label, to: payee.address, token: token.address, amount: raw.toString(), reason: "Saved payee, inside the vault's allowance.", tx: hash });
      void this.host.refresh().catch(() => undefined);
      return { ok: true, code: "Paid", text: `Paid ${this.money(raw, sym)} to ${payee.label ?? payee.address}.`, tx: hash };
    } catch (e) {
      const code = (e as Error).message.split(/\s/)[0] || "Unknown";
      return this.refuse(code, base);
    }
  }

  async requestOwnerPayment(to: string, sym: Symbol, amount: string, reason: string): Promise<ToolOutcome> {
    const s = this.state();
    const token = this.token(sym);
    const raw = this.parse(amount, sym);
    if (raw === null) return { ok: false, code: "BadAmount", text: "The amount must be a positive number like 12 or 12.50." };
    if (!isAddress(to)) return { ok: false, code: "BadAddress", text: "That is not a full 0x address. Ask the owner for it." };
    const address = getAddress(to);
    const payee = s.payees.find((p) => getAddress(p.address) === address) ?? null;
    if (!payee && !this.ownerText.toLowerCase().includes(address.toLowerCase())) {
      return { ok: false, code: "AddressNotFromOwner", text: "I only send addresses to the puck that the owner typed or saved. Ask the owner to type the address." };
    }
    const label = payee?.label ?? this.host.label(address);
    const now = await this.now();
    const note = scamNote({ to: address, token: token.address, amount: raw, now, payees: s.payees, probation: s.immutables.probation, payments: this.host.payments() });
    const last = this.actions[this.actions.length - 1];
    const merge = last && last.kind === "refused" && last.to && getAddress(last.to) === address && last.token === token.address && last.amount === raw.toString();
    if (!merge) {
      const code = this.ownerFlags().length > 0 ? "RedFlags" : payee ? null : "NotPayee";
      if (code) {
        try {
          this.host.refused({ to: address, token: token.address, amount: raw.toString(), reason: code });
        } catch {
          void 0;
        }
      }
    }
    try {
      const r = await this.host.requestPayment({ to: address, token: token.address, amount: raw.toString(), note });
      const action: AgentAction = { kind: "sent_to_puck", at: nowSec(), payee: label, to: address, token: token.address, amount: raw.toString(), reason: merge ? last.reason : String(reason || note).slice(0, 240), reqId: r.reqId };
      if (merge) this.actions[this.actions.length - 1] = action;
      else this.actions.push(action);
      return { ok: true, code: "SentToPuck", text: `Sent to the owner's puck as request ${r.reqId} (${r.tier}). The owner reads it on the puck and decides. Note shown to guardians: ${note}`, reqId: r.reqId };
    } catch (e) {
      const msg = (e as Error).message;
      const busy = /already waiting/i.test(msg);
      const why = busy ? "Your puck already has one of my requests waiting. Answer that one on the puck first, then ask me again." : `I could not send it to your puck: ${msg}`;
      if (merge) this.actions[this.actions.length - 1] = { ...last, reason: `${last.reason} ${why}` };
      else this.actions.push({ kind: "refused", at: nowSec(), payee: label, to: address, token: token.address, amount: raw.toString(), reason: why });
      return { ok: false, code: busy ? "PuckBusy" : "RequestFailed", text: why };
    }
  }
}
