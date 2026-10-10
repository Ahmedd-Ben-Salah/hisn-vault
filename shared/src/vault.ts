export enum Tier {
  INSTANT = 0,
  WAIT = 1,
  APPROVAL = 2,
}

export enum Status {
  NONE = 0,
  PENDING = 1,
  EXECUTED = 2,
  VETOED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
}

export const TIER_NAMES = ["INSTANT", "WAIT", "APPROVAL"] as const;
export const STATUS_NAMES = ["NONE", "PENDING", "EXECUTED", "VETOED", "CANCELLED", "EXPIRED"] as const;

export type TierName = (typeof TIER_NAMES)[number];
export type StatusName = (typeof STATUS_NAMES)[number];

export interface Limits {
  instantMax: bigint;
  waitMax: bigint;
  dailyCap: bigint;
  agentDailyMax: bigint;
}

export interface TierInput {
  amount: bigint;
  isPayee: boolean;
  pastProbation: boolean;
  vaultBalance: bigint;
  instantSpent2d: bigint;
  waitQueued2d: bigint;
  limits: Limits;
}

export function predictTier(i: TierInput): Tier {
  const saved = i.isPayee && i.pastProbation;
  if (saved && i.amount <= i.limits.instantMax && i.instantSpent2d + i.amount <= i.limits.dailyCap) {
    return Tier.INSTANT;
  }
  if (!i.isPayee && i.amount * 2n > i.vaultBalance) return Tier.APPROVAL;
  if (i.waitQueued2d + i.amount <= i.limits.waitMax) return Tier.WAIT;
  return Tier.APPROVAL;
}
