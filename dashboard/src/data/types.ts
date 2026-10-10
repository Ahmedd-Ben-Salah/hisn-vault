import type {
  ChangeView,
  PaymentView,
  RequestView,
  StateView,
  TimelineEntry,
} from "@hisn/shared";

export type AgentActionKind = "paid" | "refused" | "sent_to_puck";

export interface AgentAction {
  kind: AgentActionKind;
  at: number;
  payee: string | null;
  to: string | null;
  token: string;
  amount: string;
  reason: string;
  tx?: string;
  reqId?: number;
}

export interface AgentTurn {
  role: "owner" | "agent";
  text: string;
  at: number;
  actions: AgentAction[];
}

export interface AgentReply {
  reply: string;
  actions: AgentAction[];
}

export interface ChangeRequestView {
  reqId: number;
  kind: ChangeView["kind"];
  fields: Record<string, string>;
  label?: string;
  status: "waiting_puck" | "rejected" | "proposed" | "failed";
  changeId?: number;
  reason?: string;
}

export type TierName = "INSTANT" | "WAIT" | "APPROVAL";

export type Connection = "mock" | "connecting" | "live" | "offline";

export interface Snapshot {
  state: StateView;
  payments: PaymentView[];
  changes: ChangeView[];
  requests: RequestView[];
  changeRequests: ChangeRequestView[];
  log: TimelineEntry[];
  agent: AgentTurn[];
  connection: Connection;
  now: number;
}

export interface SimControls {
  kind: "mock" | "devices";
  autoPuck: boolean;
  setAutoPuck(on: boolean): void;
  serverOn: boolean;
  setServerOn?(on: boolean): void;
  puckSign(reqId: number): void;
  puckReject(reqId: number): void;
  puckSignChange(reqId: number): void;
  puckReconfirm(paymentId: number): void;
  puckCancel(paymentId: number): void;
  guardianStop(paymentId: number, who: "guardian" | "watcher"): void;
  guardianApprove(paymentId: number): void;
  freeze(who: "puck" | "guardian" | "watcher"): void;
  proposeChange(kind: ChangeView["kind"], fields: Record<string, string>): void;
  approveChange(changeId: number): void;
  vetoChange(changeId: number): void;
  reset?(): void;
}

export interface HisnSource {
  readonly kind: "mock" | "live";
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
  timeline(paymentId: number): Promise<TimelineEntry[]>;
  requestPayment(to: string, token: string, amount: string): Promise<RequestView>;
  previewTier?(to: string, token: string, amount: string): Promise<TierName>;
  /** Reason codes for the preview (new_recipient, on_probation, over_instant_max, ...). */
  previewReasons?(to: string, token: string, amount: string): Promise<string[]>;
  /** Ask the owner's puck to sign a CANCEL for this payment. The owner confirms on the puck. */
  requestStop(paymentId: number): Promise<void>;
  /** Ask the owner's puck to freeze the account. The owner confirms on the puck. */
  requestFreeze(): Promise<void>;
  requestChange(kind: ChangeView["kind"], fields: Record<string, string>): Promise<ChangeRequestView>;
  agentChat(message: string): Promise<AgentReply>;
  executeByHand(paymentId: number): Promise<string>;
  applyChange(changeId: number): Promise<string>;
  exportEvidence(paymentId: number): Promise<unknown>;
  sim?: SimControls;
}
