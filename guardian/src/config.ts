import { TESTNET } from "@hisn/shared";

export interface Config {
  vault: string;
  relayer: string;
  relayerToken: string;
  owner: string;
}

const KEY = "hisn.guardian.config";

function env(name: string): string {
  return ((import.meta.env as Record<string, string | undefined>)[name] ?? "").trim();
}

export function loadConfig(): Config {
  const base: Config = {
    vault: env("VITE_VAULT_ADDRESS"),
    relayer: env("VITE_RELAYER_URL").replace(/\/$/, ""),
    relayerToken: env("VITE_RELAYER_TOKEN"),
    owner: env("VITE_OWNER_NAME") || "Amel",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Config>;
    return { ...base, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === "string" && v !== "")) };
  } catch {
    return base;
  }
}

export function saveConfig(c: Partial<Config>): void {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function focusPayment(search: string): bigint | null {
  const raw = new URLSearchParams(search).get("payment")?.trim() ?? "";
  return /^\d{1,18}$/.test(raw) && BigInt(raw) > 0n ? BigInt(raw) : null;
}

export const MIRROR = (env("VITE_MIRROR_URL") || TESTNET.mirror).replace(/\/$/, "");
export const RPC = env("VITE_RPC_URL") || TESTNET.rpc;
export const CHAIN_ID = Number(env("VITE_CHAIN_ID") || TESTNET.chainId);
export const ON_HEDERA = MIRROR === TESTNET.mirror.replace(/\/$/, "") || /hedera\.com/.test(MIRROR);
export const SOURCE = ON_HEDERA ? "the Hedera mirror node" : "the local chain";
