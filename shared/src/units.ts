export const HBAR = "0x0000000000000000000000000000000000000000";
export const USDC_TESTNET = "0x0000000000000000000000000000000000068cDa";
export const USDC_TOKEN_ID = "0.0.429274";
export const DEMO_USDC = "0x0000000000000000000000000000000000a61b55";
export const DEMO_USDC_TOKEN_ID = "0.0.10885973";
export const TINYBAR_TO_WEIBAR = 10_000_000_000n;

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

export const TOKENS: TokenInfo[] = [
  { address: HBAR, symbol: "HBAR", decimals: 8 },
  { address: USDC_TESTNET, symbol: "USDC", decimals: 6 },
  { address: DEMO_USDC, symbol: "USDC", decimals: 6 },
];

export function tokenInfo(address: string, usdcOverride?: string): TokenInfo {
  const a = address.toLowerCase();
  if (a === HBAR) return TOKENS[0];
  if (a === USDC_TESTNET.toLowerCase() || a === DEMO_USDC.toLowerCase() || (usdcOverride && a === usdcOverride.toLowerCase())) {
    return { ...TOKENS[1], address };
  }
  throw new Error(`unknown token ${address}`);
}

export function tinybarToWeibar(tinybar: bigint): bigint {
  return tinybar * TINYBAR_TO_WEIBAR;
}

export function hbarToWei(hbar: string | number): bigint {
  return tinybarToWeibar(parseUnits(String(hbar), 8));
}

export function parseUnits(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  if (frac.length > decimals) throw new Error(`too many decimals in ${value}`);
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatAmount(raw: bigint | string, decimals: number, places = 2): string {
  const v = BigInt(raw);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, places);
  return `${neg ? "-" : ""}${whole.toString()}${places > 0 ? "." + frac : ""}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 10)}..${address.slice(-8)}`;
}
