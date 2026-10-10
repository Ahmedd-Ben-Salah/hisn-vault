import * as dotenv from "dotenv";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ContractFactory, Contract, JsonRpcProvider, Wallet, InterfaceAbi } from "ethers";
import { TESTNET, TINYBAR_TO_WEIBAR } from "@hisn/shared";

export const ROOT = resolve(__dirname, "..", "..", "..");
export const ENV_PATH = resolve(ROOT, ".env");
dotenv.config({ path: ENV_PATH });

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} in .env`);
  return v;
}

export function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const RPC_URL = opt("RPC_URL", TESTNET.rpc);
export const MIRROR_URL = opt("MIRROR_URL", TESTNET.mirror);

export function provider(): JsonRpcProvider {
  return new JsonRpcProvider(RPC_URL, 296, { staticNetwork: true, batchMaxCount: 1 });
}

export function relayer(p = provider()): Wallet {
  return new Wallet(need("RELAYER_PRIVATE_KEY"), p);
}

export function artifact(name: string): { abi: InterfaceAbi; bytecode: string } {
  const sol = name === "Day1Probe" ? "Day1Probe.sol" : `${name}.sol`;
  const path = resolve(__dirname, "..", "..", "artifacts", "contracts", sol, `${name}.json`);
  if (!existsSync(path)) throw new Error(`artifact ${name} not found; run npm -w contracts run build`);
  const a = JSON.parse(readFileSync(path, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode };
}

export async function deployContract(name: string, signer: Wallet, args: unknown[] = [], valueTinybar = 0n): Promise<Contract> {
  const a = artifact(name);
  const f = new ContractFactory(a.abi, a.bytecode, signer);
  const c = await f.deploy(...args, { gasLimit: 6_000_000, value: valueTinybar * TINYBAR_TO_WEIBAR });
  await c.waitForDeployment();
  return c as Contract;
}

export function at(name: string, address: string, signer: Wallet | JsonRpcProvider): Contract {
  return new Contract(address, artifact(name).abi, signer);
}

export async function mirror<T = any>(path: string): Promise<T> {
  const r = await fetch(`${MIRROR_URL}${path}`);
  if (!r.ok) throw new Error(`mirror ${path} -> ${r.status}`);
  return (await r.json()) as T;
}

export async function mirrorRetry<T = any>(path: string, tries = 15, waitMs = 2000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await mirror<T>(path);
    } catch (e) {
      last = e;
      await sleep(waitMs);
    }
  }
  throw last;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function txLink(hash: string): string {
  return `${TESTNET.hashscan}/transaction/${hash}`;
}

export function results(test: string, pass: boolean | null, lines: string[]): void {
  const path = resolve(ROOT, "docs", "DAY1_RESULTS.md");
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "# Day-1 results\n\nEach run appends its own section. Nothing here is edited by hand afterwards.\n");
  const verdict = pass === null ? "INCONCLUSIVE" : pass ? "PASS" : "FAIL";
  const block = [`\n## ${test}: ${verdict} (${new Date().toISOString()})\n`, ...lines.map((l) => `- ${l}`), ""].join("\n");
  appendFileSync(path, block);
  console.log(block);
}

export function setEnv(updates: Record<string, string>): void {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
    process.env[k] = v;
  }
  writeFileSync(ENV_PATH, text);
}

export function weibarToTinybar(w: bigint): bigint {
  return w / TINYBAR_TO_WEIBAR;
}
