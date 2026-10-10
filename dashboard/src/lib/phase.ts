import type { ChangeView, PaymentView, StateView } from "@hisn/shared";

export type Tone = "safe" | "hold" | "stop" | "ice" | "door" | "quiet";

export type IconName =
  | "shield"
  | "hourglass"
  | "hand"
  | "snow"
  | "check"
  | "cross"
  | "person"
  | "key"
  | "bolt"
  | "clock"
  | "warn"
  | "send"
  | "lock"
  | "list"
  | "chat"
  | "gate"
  | "people"
  | "split"
  | "download"
  | "wifi-off";

export type PhaseKey =
  | "released"
  | "stopped"
  | "cancelled"
  | "frozen_out"
  | "expired"
  | "cooling"
  | "confirm_now"
  | "needs_guardian"
  | "releasing"
  | "due";

export interface Phase {
  key: PhaseKey;
  word: string;
  icon: IconName;
  tone: Tone;
  live: boolean;
  until: number | null;
  detail: string;
}

export function phaseOf(p: PaymentView, state: Pick<StateView, "epoch">, now: number): Phase {
  if (p.status === "EXECUTED") {
    const by =
      p.executedBy === "network"
        ? "Sent by the Hedera network on time."
        : p.executedBy === "agent"
          ? "Paid by the helper inside its allowance."
          : p.tier === "INSTANT"
            ? "Paid at once: saved name, small amount."
            : "Released.";
    return { key: "released", word: "Paid", icon: "check", tone: "safe", live: false, until: null, detail: by };
  }
  if (p.status === "VETOED") {
    return {
      key: "stopped",
      word: "Stopped",
      icon: "hand",
      tone: "stop",
      live: false,
      until: null,
      detail: "Stopped by a guardian. The money never left your account.",
    };
  }
  if (p.status === "CANCELLED") {
    return {
      key: "cancelled",
      word: "Cancelled",
      icon: "cross",
      tone: "quiet",
      live: false,
      until: null,
      detail: "Cancelled by the owner, or ended by a freeze. The money never left.",
    };
  }
  if (p.status !== "PENDING" && p.status !== "EXPIRED") {
    return { key: "expired", word: "Unknown", icon: "warn", tone: "quiet", live: false, until: null, detail: "Unknown state." };
  }
  if (p.status === "PENDING" && p.epoch !== state.epoch) {
    return {
      key: "frozen_out",
      word: "Stopped by freeze",
      icon: "snow",
      tone: "ice",
      live: false,
      until: null,
      detail: "The account was frozen while this waited, so it can never be released.",
    };
  }
  if (p.status === "EXPIRED" || now > p.expiresAt) {
    return {
      key: "expired",
      word: "Expired",
      icon: "clock",
      tone: "quiet",
      live: false,
      until: null,
      detail:
        p.tier === "WAIT"
          ? "Nobody confirmed it a second time, so nothing was sent."
          : "No guardian approved it in time, so nothing was sent.",
    };
  }
  if (!p.confirmed) {
    if (p.tier === "APPROVAL") {
      return {
        key: "needs_guardian",
        word: "Needs approval",
        icon: "person",
        tone: "hold",
        live: true,
        until: p.expiresAt,
        detail: "Nothing leaves until your guardian approves.",
      };
    }
    if (now < p.confirmFrom) {
      return {
        key: "cooling",
        word: "Waiting",
        icon: "hourglass",
        tone: "hold",
        live: true,
        until: p.confirmFrom,
        detail: "Time to hang up and think. You will be asked to confirm again on your puck.",
      };
    }
    return {
      key: "confirm_now",
      word: "Confirm again",
      icon: "key",
      tone: "hold",
      live: true,
      until: p.expiresAt,
      detail: "Waiting for the owner's second yes on the puck. Doing nothing cancels it.",
    };
  }
  if (now < p.releaseAt) {
    return {
      key: "releasing",
      word: "Waiting",
      icon: "hourglass",
      tone: "hold",
      live: true,
      until: p.releaseAt,
      detail: "Leaves by itself at the set time, unless you or your guardian stop it.",
    };
  }
  return {
    key: "due",
    word: "Releasing",
    icon: "bolt",
    tone: "door",
    live: true,
    until: null,
    detail: "Release time reached. The network's scheduled call should land in a few seconds.",
  };
}

export function isOpen(ph: Phase): boolean {
  return ph.live;
}

export function canExecuteByHand(p: PaymentView, ph: Phase, now: number): boolean {
  return ph.key === "due" && now > p.releaseAt + 30;
}

export type AccountMood = "protected" | "waiting" | "frozen" | "attention";

export interface AccountStatus {
  mood: AccountMood;
  word: string;
  icon: IconName;
  tone: Tone;
  focus: PaymentView | null;
  phase: Phase | null;
  line: string;
}

export function accountStatus(state: StateView, payments: PaymentView[], now: number): AccountStatus {
  if (state.frozenUntil > now) {
    return {
      mood: "frozen",
      word: "Frozen",
      icon: "snow",
      tone: "ice",
      focus: null,
      phase: null,
      line: "Nothing can leave. The freeze ends by itself unless a different person renews it.",
    };
  }
  const open = payments
    .map((p) => ({ p, ph: phaseOf(p, state, now) }))
    .filter((x) => x.ph.live)
    .sort((a, b) => (a.ph.until ?? Infinity) - (b.ph.until ?? Infinity));
  if (open.length > 0) {
    const { p, ph } = open[0];
    const more = open.length > 1 ? ` ${open.length - 1} more waiting.` : "";
    return {
      mood: ph.key === "needs_guardian" || ph.key === "confirm_now" ? "attention" : "waiting",
      word: "Payment waiting",
      icon: "hourglass",
      tone: "hold",
      focus: p,
      phase: ph,
      line: `${ph.detail}${more}`,
    };
  }
  return {
    mood: "protected",
    word: "Protected",
    icon: "shield",
    tone: "safe",
    focus: null,
    phase: null,
    line: "Small payments to saved names go at once. Anything bigger or new waits, and a guardian can stop it.",
  };
}

export interface ChangePhase {
  word: string;
  tone: Tone;
  icon: IconName;
  until: number | null;
  canApply: boolean;
}

export function changePhaseOf(c: ChangeView, state: Pick<StateView, "keyEpoch">, now: number): ChangePhase {
  if (c.status === "EXECUTED") return { word: "Applied", tone: "safe", icon: "check", until: null, canApply: false };
  if (c.status === "VETOED") return { word: "Stopped", tone: "stop", icon: "hand", until: null, canApply: false };
  if (c.status === "CANCELLED") return { word: "Cancelled", tone: "quiet", icon: "cross", until: null, canApply: false };
  if (c.status === "EXPIRED") return { word: "Expired", tone: "quiet", icon: "clock", until: null, canApply: false };
  if (c.keyEpoch !== state.keyEpoch)
    return { word: "Void after key change", tone: "ice", icon: "snow", until: null, canApply: false };
  if (now > c.expiresAt) return { word: "Expired", tone: "quiet", icon: "clock", until: null, canApply: false };
  if (c.needsApproval && !c.approver)
    return { word: "Needs approval", tone: "hold", icon: "person", until: c.readyAt > now ? c.readyAt : c.expiresAt, canApply: false };
  if (now < c.readyAt) return { word: "Waiting", tone: "hold", icon: "hourglass", until: c.readyAt, canApply: false };
  return { word: "Ready to apply", tone: "door", icon: "bolt", until: c.expiresAt, canApply: true };
}

export const CHANGE_WORDS: Record<ChangeView["kind"], string> = {
  ADD_PAYEE: "Save a new name",
  REMOVE_PAYEE: "Remove a saved name",
  SET_LIMITS: "Change limits",
  SET_COOLOFF: "Change the cool-off",
  SET_AGENT: "Change the helper",
  ADD_GUARDIAN: "Add a guardian",
  REMOVE_GUARDIAN: "Remove a guardian",
  ADD_WATCHER: "Add an alarm light",
  REMOVE_WATCHER: "Remove an alarm light",
  UNFREEZE: "Unfreeze early",
  RECOVER_PUCK: "Replace a lost puck",
  SET_PQ_ROOT: "Install new quantum-safe keys",
};
