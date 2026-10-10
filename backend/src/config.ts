import * as dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "ethers";
import { TESTNET, USDC_TESTNET } from "./shared.js";
import { assertConfig, type Mode } from "./config-check.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = process.env.ENV_FILE ? resolve(ROOT, process.env.ENV_FILE) : resolve(ROOT, ".env");
dotenv.config({ path: envFile });

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} (env file ${envFile})`);
  return v;
}

function parseLabels(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [addr, ...rest] = part.split("=");
    if (!addr || rest.length === 0) continue;
    try {
      out[getAddress(addr.trim())] = rest.join("=").trim();
    } catch {
      continue;
    }
  }
  return out;
}

export type { Mode };

const mode = (process.env.MODE ?? "testnet") as Mode;

export const config = {
  envFile,
  mode,
  hbarScale: BigInt(process.env.HBAR_SCALE ?? (mode === "local" ? "1" : "10000000000")),
  rpcUrl: process.env.RPC_URL ?? TESTNET.rpc,
  mirrorUrl: process.env.MIRROR_URL ?? TESTNET.mirror,
  chainId: Number(process.env.CHAIN_ID ?? 296),
  vault: getAddress(req("VAULT_ADDRESS")),
  vaultId: process.env.VAULT_ID ?? null,
  topicId: process.env.HCS_TOPIC_ID || null,
  usdc: getAddress((process.env.USDC_ADDRESS ?? USDC_TESTNET).toLowerCase()),
  relayerKey: req("RELAYER_PRIVATE_KEY"),
  relayerAccountId: process.env.RELAYER_ACCOUNT_ID ?? "",
  agentKey: process.env.AGENT_PRIVATE_KEY ?? "",
  port: Number(process.env.RELAYER_PORT ?? 8787),
  host: process.env.RELAYER_HOST ?? "0.0.0.0",
  apiToken: process.env.RELAYER_API_TOKEN ?? "",
  labels: parseLabels(process.env.PAYEE_LABELS ?? ""),
  dbPath: resolve(ROOT, process.env.RELAYER_DB ?? `backend/hisn-${req("VAULT_ADDRESS").slice(2, 10).toLowerCase()}.db`),
  pollMs: Number(process.env.POLL_MS ?? (mode === "local" ? 1000 : 2000)),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 180_000),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  gas: {
    heavy: BigInt(process.env.GAS_HEAVY ?? 3_000_000),
    light: BigInt(process.env.GAS_LIGHT ?? 800_000),
  },
  llmKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "",
};

assertConfig(config);

export type Config = typeof config;
