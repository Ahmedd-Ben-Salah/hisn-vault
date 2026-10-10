import type { Wallet } from "ethers";
import type { StateView, PaymentView, RequestView } from "./shared.js";
import type { Config } from "./config.js";
import type { VaultClient } from "./chain/vault.js";
import type { Indexer } from "./indexer.js";
import type { PaymentRequestInput } from "./flows.js";

export interface AgentHost {
  config: Config;
  vault: VaultClient;
  agentWallet: Wallet | null;
  state(): StateView | null;
  payments(): PaymentView[];
  label(address: string): string | null;
  requestPayment(input: Omit<PaymentRequestInput, "source">): Promise<RequestView & { tier: string }>;
  getRequest(reqId: number): RequestView;
  refused(info: { to: string; token: string; amount: string; reason: string }): void;
  refresh(): Promise<void>;
  indexer: Indexer;
}

export interface AgentReplyOut {
  reply: string;
  actions: unknown[];
}

export interface AgentModule {
  chat(message: string): Promise<AgentReplyOut>;
  history?(): unknown;
}

export type CreateAgent = (host: AgentHost) => AgentModule | Promise<AgentModule>;
