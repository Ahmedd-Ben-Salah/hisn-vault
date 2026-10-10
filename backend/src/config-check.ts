export type Mode = "testnet" | "local";

/** Refuse to start in testnet mode without an API token (local mode may keep it empty). */
export function assertConfig(c: { mode: Mode; apiToken: string }): void {
  if (c.mode === "testnet" && !c.apiToken) throw new Error("RELAYER_API_TOKEN is required in testnet mode");
}
