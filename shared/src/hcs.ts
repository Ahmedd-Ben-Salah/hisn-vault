export const HCS_TYPES = [
  "REQUEST",
  "PAY_SIGNED",
  "PROPOSED",
  "ALERT_ACK",
  "VETO_SIGNED",
  "VETOED",
  "APPROVE_SIGNED",
  "APPROVED",
  "RECONFIRM_SIGNED",
  "CONFIRMED",
  "CANCELLED",
  "RELEASED",
  "FROZEN",
  "AGENT_PAID",
  "AGENT_REFUSED",
  "SCHEDULE_FAILED",
  "CHANGE_SIGNED",
  "CHANGE_APPROVED",
  "CHANGE_VETOED",
  "CHANGE_APPLIED",
] as const;

export type HcsType = (typeof HCS_TYPES)[number];

export interface HcsMessage {
  v: 1;
  type: HcsType;
  vault: string;
  ref: number;
  at: number;
  body: Record<string, string | number | boolean>;
  signer?: string;
  sig?: string;
  tx?: string;
}

export const SIGNED_TYPES: ReadonlySet<HcsType> = new Set<HcsType>([
  "PAY_SIGNED",
  "ALERT_ACK",
  "VETO_SIGNED",
  "APPROVE_SIGNED",
  "RECONFIRM_SIGNED",
]);

export function isHcsMessage(x: unknown): x is HcsMessage {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    m.v === 1 &&
    typeof m.type === "string" &&
    (HCS_TYPES as readonly string[]).includes(m.type) &&
    typeof m.vault === "string" &&
    typeof m.ref === "number" &&
    typeof m.at === "number" &&
    typeof m.body === "object" &&
    m.body !== null
  );
}

export function encodeHcs(m: HcsMessage): string {
  const s = JSON.stringify(m);
  if (s.length > 1000) throw new Error("HCS message over 1000 bytes");
  return s;
}

export function decodeHcs(raw: string): HcsMessage | null {
  try {
    const x: unknown = JSON.parse(raw);
    return isHcsMessage(x) ? x : null;
  } catch {
    return null;
  }
}
