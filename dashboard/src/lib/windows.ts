import type { LimitsView, PaymentView, TimelineEntry } from "@hisn/shared";

const DAY = 86400;

export interface Windows {
  instant: bigint;
  waiting: bigint;
  agent: bigint;
}

export function windowsFor(payments: PaymentView[], token: string, now: number, agentLog: TimelineEntry[] = []): Windows {
  const today = Math.floor(now / DAY);
  const inWindow = (at: number) => Math.floor(at / DAY) >= today - 1;
  const w: Windows = { instant: 0n, waiting: 0n, agent: 0n };
  for (const p of payments) {
    if (p.token.toLowerCase() !== token.toLowerCase() || !inWindow(p.proposedAt)) continue;
    const amt = BigInt(p.amount);
    if (p.executedBy === "agent") w.agent += amt;
    else if (p.tier === "INSTANT" && p.status === "EXECUTED") w.instant += amt;
    else if (p.tier === "WAIT" && (p.status === "PENDING" || p.status === "EXECUTED")) w.waiting += amt;
  }
  for (const e of agentLog) {
    if (e.hcs?.type !== "AGENT_PAID" || !inWindow(e.at)) continue;
    const b = e.hcs.body as { token?: unknown; amount?: unknown };
    if (String(b.token ?? "").toLowerCase() !== token.toLowerCase()) continue;
    try {
      w.agent += BigInt(String(b.amount ?? "0"));
    } catch {
      continue;
    }
  }
  return w;
}

export function limitBig(l: LimitsView): Record<keyof LimitsView, bigint> {
  return {
    instantMax: BigInt(l.instantMax),
    waitMax: BigInt(l.waitMax),
    dailyCap: BigInt(l.dailyCap),
    agentDailyMax: BigInt(l.agentDailyMax),
  };
}

export function ratio(used: bigint, max: bigint): number {
  if (max <= 0n) return 0;
  return Math.min(1, Number((used * 1000n) / max) / 1000);
}
