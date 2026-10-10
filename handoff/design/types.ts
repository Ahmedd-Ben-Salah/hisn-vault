// Shapes the UI works with. The API adapter converts whatever the backend returns into these.

export type Token = "USDC" | "HBAR";
export type Level = "instant" | "wait" | "approval";

export type PaymentState =
  | "waiting_confirm" // wait level, owner has not confirmed again, window not open yet
  | "confirm_now"     // wait level, second confirmation can be given now
  | "scheduled"       // confirmed or approved; the network timer is set
  | "needs_approval"  // approval level, guardian has not approved
  | "executed" | "vetoed" | "cancelled" | "expired" | "failed";

export interface Money { token: Token; amount: string } // decimal string, e.g. "100.00"

export interface Payee { address: string; name: string; since: string; instantFrom?: string; lastPaid?: string }

export interface Payment {
  id: string;
  to: string;                 // full address
  toName?: string;            // saved name, if any
  money: Money;
  level: Level;
  state: PaymentState;
  reasons: ReasonCode[];      // why it waits or needs approval
  proposedAt: string;         // ISO time
  confirmFrom?: string;       // when the second confirmation opens
  releaseAt?: string;
  expiresAt?: string;
  finishedAt?: string;
  finishedBy?: "network" | "owner" | "guardian" | "manual";
  failReason?: string;
  source: "owner" | "helper";
  proof: { transactionId?: string; scheduleId?: string; topicId?: string };
}

export type ReasonCode =
  | "new_recipient" | "over_instant_limit" | "over_daily_cap" | "over_wait_limit"
  | "more_than_half_balance" | "payee_on_probation";

export type FactCode = "never_paid" | "times_usual" | "own_device" | "nth_this_week";
export interface Fact { code: FactCode; value?: number; tone: "warn" | "ok" }

export interface TimelineStep {
  key: "asked" | "signed" | "guardian_alerted" | "confirmed" | "approved" | "released" | "stopped";
  at?: string; done: boolean; current?: boolean; detail?: string; link?: string;
}

export interface Limits { instantMax: string; waitMax: string; dailyCap: string; helperDailyMax: string }

export interface AccountState {
  owner: { name: string };
  vault: string;
  balances: Money[];
  freeToSendNow: Money[];
  limits: Record<Token, Limits>;
  usedToday: Record<Token, { instant: string; wait: string; helper: string }>;
  coolOffSeconds: number;
  locked: { settingsDelaySeconds: number; recoveryDelaySeconds: number; minCoolOffSeconds: number };
  frozenUntil?: string;
  frozenBy?: string;
  guardians: { name: string; address: string; since?: string }[];
  devices: { kind: "puck" | "guardian_light" | "guardian_phone"; label: string; online: boolean }[];
  payees: Payee[];
  network: "testnet";
}

export interface Preview { level: Level; reasons: ReasonCode[]; releaseAfterSeconds?: number; blocked?: string }

export interface PayRequest { id: string; status: "waiting_puck" | "rejected" | "proposed" | "failed"; paymentId?: string; error?: string }

export interface Change { id: string; kind: string; summary: string; readyAt: string; expiresAt: string; approved: boolean; status: "pending" | "applied" | "stopped" | "expired" }

export interface HelperMessage { from: "you" | "helper"; text: string; tone?: "normal" | "refused"; paymentId?: string; requestId?: string }
