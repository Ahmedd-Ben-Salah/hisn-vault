import { Interface, getAddress, type InterfaceAbi } from "ethers";
import { HBAR, TESTNET, decodeHcs, evmAddressToEntityId, type HcsMessage } from "@hisn/shared";
import vaultJson from "../../shared/abi/HisnVault.json";
import deployment from "../../deployments/testnet.json";

export const iface = new Interface(((vaultJson as { abi?: InterfaceAbi }).abi ?? vaultJson) as InterfaceAbi);

export const TIER = { INSTANT: 0, WAIT: 1, APPROVAL: 2 } as const;

export interface Source {
  mirror: string;
  vault: string;
  vaultId: string;
  topic: string;
}

function env(name: string): string {
  return ((import.meta.env as Record<string, string | undefined>)[name] ?? "").trim();
}

export function wanted(search: string): { mirror: string; vault: string; topic: string } {
  const q = new URLSearchParams(search);
  return {
    mirror: (env("VITE_MIRROR_URL") || TESTNET.mirror).replace(/\/$/, ""),
    vault: (q.get("vault") ?? "").trim() || env("VITE_VAULT") || deployment.vaultId,
    topic: (q.get("topic") ?? "").trim() || env("VITE_TOPIC") || deployment.topicId,
  };
}

export class Mirror {
  constructor(readonly base: string) {}

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`);
    if (!res.ok) throw new Error(`mirror node ${res.status} on ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }

  async call<T = unknown>(vault: string, fn: string, args: unknown[] = []): Promise<T> {
    const res = await fetch(`${this.base}/api/v1/contracts/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: vault, data: iface.encodeFunctionData(fn, args), block: "latest", estimate: false }),
    });
    if (!res.ok) throw new Error(`mirror node ${res.status} on ${fn}`);
    const out = iface.decodeFunctionResult(fn, ((await res.json()) as { result: string }).result);
    return (out.length === 1 ? out[0] : out) as T;
  }

  async all<T>(path: string, key: string, cap = 2000): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    while (next && out.length < cap) {
      const page: Record<string, unknown> & { links?: { next: string | null } } = await this.get(next);
      out.push(...((page[key] as T[]) ?? []));
      next = page.links?.next ?? null;
    }
    return out;
  }
}

export async function resolve(w: { mirror: string; vault: string; topic: string }): Promise<Source> {
  const m = new Mirror(w.mirror);
  if (w.vault === deployment.vaultId || w.vault.toLowerCase() === deployment.vault.toLowerCase()) {
    return { mirror: w.mirror, vault: deployment.vault, vaultId: deployment.vaultId, topic: w.topic };
  }
  const c = await m.get<{ contract_id: string; evm_address: string }>(`/api/v1/contracts/${w.vault}`);
  return { mirror: w.mirror, vault: getAddress(c.evm_address), vaultId: c.contract_id, topic: w.topic };
}

export interface TokenRules {
  address: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  instantMax: bigint;
  waitMax: bigint;
  dailyCap: bigint;
  agentDailyMax: bigint;
}

export interface Rules {
  puck: string;
  guardians: string[];
  watchers: string[];
  agent: string;
  payees: string[];
  coolOff: number;
  minCoolOff: number;
  settingsDelay: number;
  recoveryDelay: number;
  approvalWindow: number;
  freezeMax: number;
  frozenUntil: number;
  paymentCount: number;
  tokens: TokenRules[];
}

type LimitsTuple = [bigint, bigint, bigint, bigint];

async function tokenRules(m: Mirror, s: Source, address: string): Promise<TokenRules> {
  const lim = await m.call<LimitsTuple>(s.vault, "limits", [address]);
  const base = { address, instantMax: lim[0], waitMax: lim[1], dailyCap: lim[2], agentDailyMax: lim[3] };
  if (address.toLowerCase() === HBAR) {
    const acc = await m.get<{ balance: { balance: number } }>(`/api/v1/accounts/${s.vaultId}`);
    return { ...base, symbol: "HBAR", decimals: 8, balance: BigInt(acc.balance.balance) };
  }
  const id = evmAddressToEntityId(address) ?? address;
  const [info, held] = await Promise.all([
    m.get<{ symbol: string; decimals: string }>(`/api/v1/tokens/${id}`),
    m.get<{ tokens: Array<{ balance: number }> }>(`/api/v1/accounts/${s.vaultId}/tokens?token.id=${id}`),
  ]);
  return { ...base, symbol: info.symbol, decimals: Number(info.decimals), balance: BigInt(held.tokens[0]?.balance ?? 0) };
}

export async function readRules(m: Mirror, s: Source): Promise<Rules> {
  const v = s.vault;
  const [puck, guardians, watchers, agent, payees, coolOff, minCoolOff, settingsDelay, recoveryDelay, approvalWindow, freezeMax, frozenUntil, paymentCount, usdc] =
    await Promise.all([
      m.call<string>(v, "puck"),
      m.call<string[]>(v, "getGuardians"),
      m.call<string[]>(v, "getWatchers"),
      m.call<string>(v, "agent"),
      m.call<string[]>(v, "getPayees"),
      m.call<bigint>(v, "coolOff"),
      m.call<bigint>(v, "MIN_COOLOFF"),
      m.call<bigint>(v, "SETTINGS_DELAY"),
      m.call<bigint>(v, "RECOVERY_DELAY"),
      m.call<bigint>(v, "APPROVAL_WINDOW"),
      m.call<bigint>(v, "FREEZE_MAX"),
      m.call<bigint>(v, "frozenUntil"),
      m.call<bigint>(v, "paymentCount"),
      m.call<string>(v, "USDC"),
    ]);
  const tokens = await Promise.all([usdc, HBAR].map((t) => tokenRules(m, s, t)));
  return {
    puck,
    guardians: [...guardians],
    watchers: [...watchers],
    agent,
    payees: [...payees],
    coolOff: Number(coolOff),
    minCoolOff: Number(minCoolOff),
    settingsDelay: Number(settingsDelay),
    recoveryDelay: Number(recoveryDelay),
    approvalWindow: Number(approvalWindow),
    freezeMax: Number(freezeMax),
    frozenUntil: Number(frozenUntil),
    paymentCount: Number(paymentCount),
    tokens,
  };
}

export interface MirrorLog {
  data: string;
  topics: string[];
  timestamp: string;
  transaction_hash: string;
}

export interface VaultEvent {
  name: string;
  args: Record<string, unknown>;
  at: string;
  tx: string;
}

export function parseLogs(logs: MirrorLog[]): VaultEvent[] {
  const out: VaultEvent[] = [];
  for (const l of logs) {
    try {
      const d = iface.parseLog({ topics: l.topics, data: l.data });
      if (!d) continue;
      out.push({ name: d.name, args: Object.fromEntries(d.fragment.inputs.map((p, i) => [p.name, d.args[i]])), at: l.timestamp, tx: l.transaction_hash });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => cmp(a.at, b.at));
}

export async function readEvents(m: Mirror, s: Source): Promise<VaultEvent[]> {
  return parseLogs(await m.all<MirrorLog>(`/api/v1/contracts/${s.vaultId}/results/logs?order=asc&limit=100`, "logs"));
}

export function cmp(a: string, b: string): number {
  const [as, an = ""] = a.split(".");
  const [bs, bn = ""] = b.split(".");
  return Number(as) - Number(bs) || an.padEnd(9, "0").localeCompare(bn.padEnd(9, "0"));
}

export interface LogLine {
  seq: number;
  at: string;
  msg: HcsMessage | null;
}

interface MirrorMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
}

export function decodeMessage(base64: string): HcsMessage | null {
  try {
    return decodeHcs(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export function forVault(lines: LogLine[], vault: string): LogLine[] {
  return lines.filter((l) => l.msg && l.msg.vault.toLowerCase() === vault.toLowerCase());
}

export async function readTopic(m: Mirror, s: Source, limit = 300): Promise<LogLine[]> {
  const raw = await m.all<MirrorMessage>(`/api/v1/topics/${s.topic}/messages?order=desc&limit=100`, "messages", limit);
  return forVault(
    raw.map((r) => ({ seq: r.sequence_number, at: r.consensus_timestamp, msg: decodeMessage(r.message) })),
    s.vault,
  );
}

export type StepKind = "proposed" | "alerted" | "confirmed" | "approved" | "vetoed" | "executed" | "cancelled" | "expired" | "failed";

export interface Step {
  kind: StepKind;
  at: string;
  tx?: string;
  by?: string;
  seq?: number;
}

export type Outcome = "waiting" | "executed" | "vetoed" | "cancelled" | "expired";

export interface Story {
  id: number;
  to: string;
  token: string;
  amount: bigint;
  tier: number;
  releaseAt: number;
  steps: Step[];
  schedule: string | null;
  outcome: Outcome;
  executedAt: string | null;
}

const ENDS: Record<string, [StepKind, Outcome]> = {
  Executed: ["executed", "executed"],
  Vetoed: ["vetoed", "vetoed"],
  Cancelled: ["cancelled", "cancelled"],
  Expired: ["expired", "expired"],
};

export function buildStories(events: VaultEvent[], log: LogLine[], guardians: string[]): Story[] {
  const isGuardian = new Set(guardians.map((g) => g.toLowerCase()));
  const byId = new Map<number, Story>();
  for (const e of events) {
    if (e.args.id === undefined || !["Proposed", "Confirmed", "Vetoed", "Executed", "Cancelled", "Expired", "ScheduleFailed"].includes(e.name)) continue;
    const id = Number(e.args.id as bigint);
    if (e.name === "Proposed") {
      byId.set(id, {
        id,
        to: e.args.to as string,
        token: e.args.token as string,
        amount: e.args.amount as bigint,
        tier: Number(e.args.tier as bigint),
        releaseAt: Number(e.args.releaseAt as bigint),
        steps: [{ kind: "proposed", at: e.at, tx: e.tx }],
        schedule: null,
        outcome: "waiting",
        executedAt: null,
      });
      continue;
    }
    const s = byId.get(id);
    if (!s) continue;
    if (e.name === "Confirmed") {
      const by = e.args.by as string;
      s.steps.push({ kind: isGuardian.has(by.toLowerCase()) ? "approved" : "confirmed", at: e.at, tx: e.tx, by });
      s.schedule = evmAddressToEntityId(e.args.schedule as string);
    } else if (e.name === "ScheduleFailed") {
      s.steps.push({ kind: "failed", at: e.at, tx: e.tx });
    } else {
      const [kind, outcome] = ENDS[e.name];
      s.steps.push({ kind, at: e.at, tx: e.tx, by: (e.args.by ?? e.args.caller) as string | undefined });
      s.outcome = outcome;
      if (kind === "executed") s.executedAt = e.at;
    }
  }
  for (const l of log) {
    if (l.msg?.type !== "ALERT_ACK") continue;
    const s = byId.get(l.msg.ref);
    if (s && !s.steps.some((x) => x.kind === "alerted")) s.steps.push({ kind: "alerted", at: l.at, by: l.msg.signer, seq: l.seq });
  }
  for (const s of byId.values()) s.steps.sort((a, b) => cmp(a.at, b.at));
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export interface Release {
  txId: string;
  scheduled: boolean;
  result: string;
  payer: string | null;
  scheduleExecuted: string | null;
}

interface MirrorTx {
  transaction_id: string;
  consensus_timestamp: string;
  scheduled: boolean;
  result: string;
  entity_id: string | null;
}

export async function readRelease(m: Mirror, s: Story): Promise<Release | null> {
  if (!s.executedAt) return null;
  const [txs, sched] = await Promise.all([
    m.get<{ transactions: MirrorTx[] }>(`/api/v1/transactions?timestamp=${s.executedAt}`),
    s.schedule ? m.get<{ executed_timestamp: string | null; payer_account_id: string }>(`/api/v1/schedules/${s.schedule}`).catch(() => null) : Promise.resolve(null),
  ]);
  const t = txs.transactions.find((x) => x.consensus_timestamp === s.executedAt) ?? txs.transactions[0];
  if (!t) return null;
  return { txId: t.transaction_id, scheduled: t.scheduled, result: t.result, payer: sched?.payer_account_id ?? null, scheduleExecuted: sched?.executed_timestamp ?? null };
}

export interface AgentPayment {
  to: string;
  token: string;
  amount: bigint;
  at: string;
  tx: string;
}

export function agentPayments(events: VaultEvent[]): AgentPayment[] {
  return events
    .filter((e) => e.name === "AgentPaid")
    .map((e) => ({ to: e.args.to as string, token: e.args.token as string, amount: e.args.amount as bigint, at: e.at, tx: e.tx }))
    .reverse();
}

export function txLink(hashOrId: string): string {
  return `${TESTNET.hashscan}/transaction/${hashOrId}`;
}

export function consensusDate(at: string): Date {
  return new Date(Number(at.split(".")[0]) * 1000);
}
