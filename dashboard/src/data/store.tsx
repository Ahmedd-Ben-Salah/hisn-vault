import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { DEMO_USDC, HBAR, USDC_TESTNET } from "@hisn/shared";
import { LiveSource } from "./live";
import { MockSource } from "./mock";
import type { HisnSource, Snapshot } from "./types";

const SourceContext = createContext<HisnSource | null>(null);

const CONNECTION = "hisn.dashboard.connection";

export interface Connection {
  url: string;
  token: string;
}

export function savedConnection(): Connection | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONNECTION) ?? "null") as Partial<Connection> | null;
    return c && typeof c.url === "string" && c.url ? { url: c.url, token: typeof c.token === "string" ? c.token : "" } : null;
  } catch {
    return null;
  }
}

export function saveConnection(c: Connection | null): void {
  try {
    if (c) localStorage.setItem(CONNECTION, JSON.stringify({ url: c.url.trim().replace(/\/$/, ""), token: c.token.trim() }));
    else localStorage.removeItem(CONNECTION);
  } catch {
    return;
  }
}

export function makeSource(): HisnSource {
  const saved = savedConnection();
  const url = saved?.url ?? (import.meta.env.VITE_RELAYER_URL as string | undefined);
  const token = saved ? saved.token : ((import.meta.env.VITE_RELAYER_TOKEN as string | undefined) ?? "");
  const params = new URLSearchParams(window.location.search);
  if (url && !params.has("mock")) return new LiveSource(url.replace(/\/$/, ""), token, (import.meta.env.VITE_SIM_URL as string | undefined) ?? "");
  return new MockSource(params.get("scene"));
}

export function SourceProvider({ source, children }: { source: HisnSource; children: ReactNode }) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}

export function useSource(): HisnSource {
  const s = useContext(SourceContext);
  if (!s) throw new Error("SourceProvider missing");
  return s;
}

export function useSnapshot(): Snapshot {
  const s = useSource();
  return useSyncExternalStore(
    (l) => s.subscribe(l),
    () => s.getSnapshot(),
  );
}

export function useUsdc(): string {
  const source = useSource();
  const { state, payments, requests } = useSnapshot();
  const declared = (state as { usdc?: string }).usdc;
  if (declared) return declared;
  if (source.kind === "mock") return USDC_TESTNET;
  const fromEnv = (import.meta.env.VITE_USDC_ADDRESS as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  const seen = [...payments.map((p) => p.token), ...requests.map((r) => r.token)].find((t) => t.toLowerCase() !== HBAR);
  return seen ?? DEMO_USDC;
}
