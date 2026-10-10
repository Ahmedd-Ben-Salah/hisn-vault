import type { PayeeView } from "@hisn/shared";
import type { Symbol } from "./types.js";

export type Intent =
  | { type: "pay"; payee: PayeeView | null; address: string | null; amount: string | null; symbol: Symbol; flags: string[] }
  | { type: "balance" }
  | { type: "allowance" }
  | { type: "help" };

const FLAG_PATTERNS: Array<[RegExp, string]> = [
  [/\b(urgent|urgently|right now|immediately|asap|hurry|quick(ly)?)\b/i, "it is urgent"],
  [/\b(secret|don'?t tell|do not tell|keep (it|this) (quiet|between))\b/i, "it must stay secret"],
  [/\b(gift ?cards?|voucher|crypto atm)\b/i, "it asks for gift cards or vouchers"],
  [/\b(safe (wallet|account)|new (wallet|account|address)|move (all|your|my) (money|funds|savings))\b/i, "it asks to move money to a 'safe' place"],
  [/\b(police|customs|lawyer|bail|hospital|accident|arrested|kidnap)/i, "it uses an emergency story"],
  [/\b(ignore (all|previous|the above)|system prompt|you are now|disregard)\b/i, "the text tries to give me orders"],
];

const ALLOWANCE = /\b(allowance|left today|how much can you|still pay)\b/;
const BALANCE = /\b(balance|how much|money do i have|funds)\b/;

export function redFlags(text: string): string[] {
  return FLAG_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

function normal(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findPayee(text: string, payees: PayeeView[]): PayeeView | null {
  const t = ` ${normal(text)} `;
  let best: PayeeView | null = null;
  let bestScore = 0;
  for (const p of payees) {
    if (!p.label) continue;
    const words = normal(p.label)
      .split(" ")
      .filter((w) => w.length >= 3);
    const score = words.filter((w) => t.includes(` ${w} `)).length;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export function findPayeeByLabel(label: string, payees: PayeeView[]): PayeeView | null {
  const want = normal(label);
  if (!want) return null;
  return payees.find((p) => p.label && normal(p.label) === want) ?? findPayee(label, payees);
}

export function findAmount(text: string): string | null {
  const t = text.replace(/0x[0-9a-fA-F]{40}/g, " ").replace(/(\d),(\d{3})\b/g, "$1$2");
  const withUnit = t.match(/(\d+(?:\.\d{1,8})?)\s*(?:usdc|hbar|dinars?|dollars?|tnd|dt)\b/i) ?? t.match(/\$\s*(\d+(?:\.\d{1,8})?)/);
  if (withUnit) return withUnit[1];
  const bare = [...t.matchAll(/(^|[^#\w.])(\d+(?:\.\d{1,8})?)(?![\w.])/g)];
  return bare.length > 0 ? bare[0][2] : null;
}

export function parseIntent(text: string, payees: PayeeView[]): Intent {
  const t = text.trim();
  const lower = t.toLowerCase();
  const address = t.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? null;
  const amount = findAmount(t);
  const symbol: Symbol = /hbar/i.test(t) ? "HBAR" : "USDC";
  const payVerb = /\b(pay|send|transfer|give|settle|wire)\b/i.test(t);
  const payee = findPayee(t, payees);
  if (!amount && !address) {
    if (ALLOWANCE.test(lower)) return { type: "allowance" };
    if (BALANCE.test(lower)) return { type: "balance" };
  }
  if (payVerb || address || (payee && amount)) {
    return { type: "pay", payee, address, amount, symbol, flags: redFlags(t) };
  }
  if (ALLOWANCE.test(lower)) return { type: "allowance" };
  if (BALANCE.test(lower)) return { type: "balance" };
  return { type: "help" };
}
