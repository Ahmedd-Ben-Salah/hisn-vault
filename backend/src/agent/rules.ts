import type { PayeeView } from "@hisn/shared";
import { canRouteToPuck, type AgentCore } from "./core.js";
import { parseIntent } from "./intent.js";

const TO_PUCK = "I've sent it to your puck, where you can read it yourself and decide. Before you do, call someone you trust on a number you already know.";

function whyNot(flags: string[]): string {
  return flags.length > 0 ? `This looks like how scams look: ${flags.join(", ")}.` : "That's not a saved name, and I never pay new people.";
}

export async function enforceRouting(core: AgentCore, message: string, payees: PayeeView[]): Promise<string | null> {
  const intent = parseIntent(message, payees);
  if (intent.type !== "pay" || !intent.amount) return null;
  if (intent.flags.length === 0 && intent.payee) return null;
  if (core.actions.some((a) => a.kind === "paid" || a.kind === "sent_to_puck")) return null;
  const to = intent.payee?.address ?? intent.address;
  if (!to) {
    if (core.actions.length === 0) await core.paySmall(intent.payee?.label ?? "unknown", intent.symbol, intent.amount);
    return null;
  }
  const r = await core.requestOwnerPayment(to, intent.symbol, intent.amount, whyNot(intent.flags));
  return r.ok ? TO_PUCK : null;
}

export async function rulesReply(core: AgentCore, message: string, payees: PayeeView[]): Promise<string> {
  const intent = parseIntent(message, payees);
  if (intent.type === "balance") {
    const s = await core.getState();
    const b = s.balances as { USDC: string; HBAR: string };
    return `You have ${b.USDC} and ${b.HBAR}. ${String(s.gasReserve)} of the HBAR is kept aside to pay for the network's release calls.`;
  }
  if (intent.type === "allowance") {
    return `I can still pay ${core.money(await core.allowanceLeft("USDC"), "USDC")} and ${core.money(await core.allowanceLeft("HBAR"), "HBAR")}, only to saved names. The vault counts today and yesterday together, and it enforces this, not me.`;
  }
  if (intent.type === "help") {
    return "I pay small bills to names you have saved, inside the allowance the vault gives me. I can't approve, stop, change rules or raise my own limit. Try: \"Pay the STEG bill, 12 USDC\".";
  }
  if (!intent.amount) return "How much should I pay? Tell me the amount and who it's for.";
  const flags = intent.flags;
  if (flags.length > 0 || !intent.payee) {
    const why = whyNot(flags);
    const to = intent.payee?.address ?? intent.address;
    if (!to) {
      await core.paySmall(intent.payee?.label ?? "unknown", intent.symbol, intent.amount);
      return `I won't pay this. ${why} If you still want to, send it from the Send page so your puck shows it.`;
    }
    const r = await core.requestOwnerPayment(to, intent.symbol, intent.amount, why);
    return r.ok
      ? `I won't pay this. ${why} ${TO_PUCK}`
      : `I won't pay this. ${why} ${r.text}`;
  }
  const paid = await core.paySmall(intent.payee.label ?? intent.payee.address, intent.symbol, intent.amount);
  if (paid.ok) return `Done. ${paid.text} The vault checked the name and my allowance before paying.`;
  if (!canRouteToPuck(paid.code)) return `I couldn't pay: ${paid.text}`;
  const r = await core.requestOwnerPayment(intent.payee.address, intent.symbol, intent.amount, paid.text);
  return r.ok ? `The vault said no to me: ${paid.text} I've sent it to your puck instead, so you can approve it yourself.` : `The vault said no to me: ${paid.text} ${r.text}`;
}
