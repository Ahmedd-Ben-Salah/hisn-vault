import type { ChangeFields } from "@hisn/shared";

export const TIER = { INSTANT: 0, WAIT: 1, APPROVAL: 2 } as const;
export const STATUS = { NONE: 0, PENDING: 1, EXECUTED: 2, VETOED: 3, CANCELLED: 4, EXPIRED: 5 } as const;
export const ROLE = { NONE: 0, PUCK: 1, GUARDIAN: 2, WATCHER: 3, AGENT: 4 } as const;

export interface Pay {
  id: bigint;
  to: string;
  token: string;
  amount: bigint;
  proposedAt: number;
  confirmFrom: number;
  releaseAt: number;
  expiresAt: number;
  epoch: number;
  tier: number;
  status: number;
  confirmed: boolean;
  isPayee: boolean;
}

export interface Chg {
  id: bigint;
  kind: number;
  data: string;
  proposedAt: number;
  readyAt: number;
  expiresAt: number;
  proposer: string;
  approver: string;
  keyEpoch: number;
  status: number;
  fields: ChangeFields | null;
}

export interface View {
  mode: "live" | "demo";
  pending: Pay[];
  changes: Chg[];
  epoch: number;
  keyEpoch: number;
  frozenUntil: number;
  lastFreezer: string;
  myRole: number;
  checkedAt: number;
  error: string | null;
  gone?: Pay;
}

export type Path = "relayer" | "direct" | "demo";

export interface Done {
  path: Path;
  tx: string;
}

export interface Actions {
  stop(p: Pay): Promise<Done>;
  approve(p: Pay): Promise<Done>;
  freeze(): Promise<Done>;
  renewFreeze(): Promise<Done>;
  approveChange(c: Chg): Promise<Done>;
  stopChange(c: Chg): Promise<Done>;
}
