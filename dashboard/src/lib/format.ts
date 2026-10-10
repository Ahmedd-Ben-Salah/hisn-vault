import { DEMO_USDC, HBAR, USDC_TESTNET, formatAmount, parseUnits, type TokenInfo } from "@hisn/shared";

const KNOWN: TokenInfo[] = [
  { address: HBAR, symbol: "HBAR", decimals: 8 },
  { address: USDC_TESTNET, symbol: "USDC", decimals: 6 },
  { address: DEMO_USDC, symbol: "USDC", decimals: 6 },
];

const declared = new Set<string>();

export function registerUsdc(address: string | undefined | null): void {
  if (address) declared.add(address.toLowerCase());
}

export function token(address: string): TokenInfo {
  const a = address.toLowerCase();
  const known = KNOWN.find((t) => t.address.toLowerCase() === a);
  if (known) return known;
  if (declared.has(a)) return { address, symbol: "USDC", decimals: 6 };
  return { address, symbol: "TOKEN", decimals: 0 };
}

export function tokenBySymbol(symbol: "HBAR" | "USDC"): TokenInfo {
  return symbol === "HBAR" ? KNOWN[0] : KNOWN[1];
}

export function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function amount(raw: string | bigint, tokenAddress: string, places = 2): string {
  const t = token(tokenAddress);
  const s = formatAmount(BigInt(raw), t.decimals, places);
  const [w, f] = s.split(".");
  return f === undefined ? group(w) : `${group(w)}.${f}`;
}

export function money(raw: string | bigint, tokenAddress: string, places = 2): string {
  return `${amount(raw, tokenAddress, places)} ${token(tokenAddress).symbol}`;
}

export function toRaw(value: string, tokenAddress: string): bigint | null {
  const v = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  try {
    return parseUnits(v, token(tokenAddress).decimals);
  } catch {
    return null;
  }
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

export function duration(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

export function ago(at: number, now: number): string {
  const d = now - at;
  if (d < 10) return "just now";
  if (d < 60) return `${d} s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

export function timeOfDay(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateTime(at: number): string {
  return new Date(at * 1000).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function short(address: string): string {
  if (address.length < 20) return address;
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

export function consensus(ts: string): string {
  const [sec, nanos = "0"] = ts.split(".");
  return `${timeOfDay(Number(sec))}.${nanos.padEnd(9, "0").slice(0, 3)}`;
}
