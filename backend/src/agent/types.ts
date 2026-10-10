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

export type Symbol = "USDC" | "HBAR";
