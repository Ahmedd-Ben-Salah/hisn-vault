import { Contract, Interface, NonceManager, Wallet, TransactionReceipt, ContractTransactionResponse } from "ethers";
import vaultAbi from "../../../shared/abi/HisnVault.json" with { type: "json" };
import type { Config } from "../config.js";
import { RetryProvider } from "./provider.js";

export const vaultInterface = new Interface(vaultAbi.abi);
export const VAULT_ABI = vaultAbi.abi;

export interface Sent {
  hash: string;
  receipt: Promise<TransactionReceipt>;
}

const HEAVY = new Set(["propose", "proposePQ", "approve", "reconfirm", "reconfirmPQ", "freeze", "proposeChange", "proposeChangePQ", "executeChange", "execute", "agentPay"]);

export class VaultClient {
  readonly provider: RetryProvider;
  readonly wallet: Wallet;
  readonly signer: NonceManager;
  readonly read: Contract;
  readonly write: Contract;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private cfg: Config) {
    this.provider = new RetryProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, batchMaxCount: 1, pollingInterval: 1500 });
    this.wallet = new Wallet(cfg.relayerKey, this.provider);
    this.signer = new NonceManager(this.wallet);
    this.read = new Contract(cfg.vault, vaultAbi.abi, this.provider);
    this.write = new Contract(cfg.vault, vaultAbi.abi, this.signer);
  }

  get address(): string {
    return this.wallet.address;
  }

  submit(method: string, args: unknown[]): Promise<Sent> {
    const run = async (): Promise<Sent> => {
      const gasLimit = HEAVY.has(method) ? this.cfg.gas.heavy : this.cfg.gas.light;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.read.getFunction(method).staticCall(...args, { from: this.wallet.address });
          const tx = (await this.write.getFunction(method)(...args, { gasLimit })) as ContractTransactionResponse;
          const receipt = tx.wait().then((r) => {
            if (!r || r.status !== 1) throw new RelayError(`${method} reverted on chain`);
            return r;
          });
          receipt.catch(() => undefined);
          return { hash: tx.hash, receipt };
        } catch (e) {
          lastErr = e;
          this.signer.reset();
          if (isRevert(e)) break;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      throw new RelayError(describeError(lastErr), lastErr);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async send(method: string, args: unknown[]): Promise<{ hash: string; receipt: TransactionReceipt }> {
    const s = await this.submit(method, args);
    return { hash: s.hash, receipt: await s.receipt };
  }

  async now(): Promise<number> {
    const b = await this.provider.getBlock("latest");
    return b ? b.timestamp : Math.floor(Date.now() / 1000);
  }
}

export class RelayError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

function isRevert(e: unknown): boolean {
  const x = e as { code?: string; revert?: unknown; data?: unknown };
  return x?.code === "CALL_EXCEPTION" || !!x?.revert;
}

export function describeError(e: unknown): string {
  const x = e as { revert?: { name?: string }; data?: string; shortMessage?: string; message?: string; info?: { error?: { data?: string } } };
  if (x?.revert?.name) return x.revert.name;
  const data = typeof x?.data === "string" ? x.data : x?.info?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = vaultInterface.parseError(data);
      if (parsed) return parsed.name;
    } catch {
      return x?.shortMessage ?? x?.message ?? "unknown error";
    }
  }
  return x?.shortMessage ?? x?.message ?? "unknown error";
}
