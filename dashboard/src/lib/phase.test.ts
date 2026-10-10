import { describe, expect, it } from "vitest";
import type { ChangeView, PaymentView, StateView } from "@hisn/shared";
import { accountStatus, canExecuteByHand, changePhaseOf, phaseOf } from "./phase";

const T = 1_760_000_000;

function pay(over: Partial<PaymentView> = {}): PaymentView {
  return {
    id: 1,
    to: "0x8d1fe0c4b2a39e7d6c5b4a3f2e1d0c9b8a7f6e51",
    token: "0x0000000000000000000000000000000000068cDa",
    amount: "100000000",
    tier: "WAIT",
    status: "PENDING",
    proposedAt: T,
    confirmFrom: T + 30,
    releaseAt: T + 60,
    expiresAt: T + 1860,
    epoch: 1,
    confirmed: false,
    schedule: null,
    label: null,
    newRecipient: true,
    txs: {},
    ...over,
  };
}

const state = { epoch: 1, keyEpoch: 1, frozenUntil: 0 } as StateView;

describe("phaseOf", () => {
  it("walks a WAIT payment through its life", () => {
    expect(phaseOf(pay(), state, T + 10).key).toBe("cooling");
    expect(phaseOf(pay(), state, T + 10).until).toBe(T + 30);
    expect(phaseOf(pay(), state, T + 31).key).toBe("confirm_now");
    expect(phaseOf(pay({ confirmed: true }), state, T + 40).key).toBe("releasing");
    expect(phaseOf(pay({ confirmed: true }), state, T + 61).key).toBe("due");
    expect(phaseOf(pay({ status: "EXECUTED", executedBy: "network" }), state, T + 70).detail).toMatch(/Hedera network/);
  });
  it("never shows an unconfirmed payment as releasing", () => {
    expect(phaseOf(pay(), state, T + 500).key).toBe("confirm_now");
    expect(phaseOf(pay(), state, T + 1861).key).toBe("expired");
    expect(phaseOf(pay({ status: "EXPIRED" }), state, T + 100).key).toBe("expired");
  });
  it("asks for a guardian on APPROVAL", () => {
    const ph = phaseOf(pay({ tier: "APPROVAL", confirmFrom: T }), state, T + 5);
    expect(ph.key).toBe("needs_guardian");
    expect(ph.live).toBe(true);
  });
  it("shows stops and cancels as final", () => {
    expect(phaseOf(pay({ status: "VETOED" }), state, T).key).toBe("stopped");
    expect(phaseOf(pay({ status: "CANCELLED" }), state, T).live).toBe(false);
  });
  it("treats an old-epoch payment as dead", () => {
    expect(phaseOf(pay({ epoch: 0 }), state, T + 10).key).toBe("frozen_out");
  });
});

describe("canExecuteByHand", () => {
  it("only after the timer is 30 s late", () => {
    const p = pay({ confirmed: true });
    expect(canExecuteByHand(p, phaseOf(p, state, T + 80), T + 80)).toBe(false);
    expect(canExecuteByHand(p, phaseOf(p, state, T + 91), T + 91)).toBe(true);
    expect(canExecuteByHand(pay(), phaseOf(pay(), state, T + 91), T + 91)).toBe(false);
  });
});

describe("accountStatus", () => {
  it("frozen wins over waiting, waiting over protected", () => {
    expect(accountStatus({ ...state, frozenUntil: T + 100 }, [pay()], T).mood).toBe("frozen");
    expect(accountStatus(state, [pay()], T + 10).word).toBe("Payment waiting");
    expect(accountStatus(state, [pay({ status: "EXECUTED" })], T + 10).mood).toBe("protected");
  });
  it("focuses the payment that ends soonest", () => {
    const a = pay({ id: 1, confirmed: true });
    const b = pay({ id: 2, proposedAt: T + 5, confirmFrom: T + 35, releaseAt: T + 65 });
    expect(accountStatus(state, [b, a], T + 40).focus?.id).toBe(1);
  });
});

describe("changePhaseOf", () => {
  const c: ChangeView = {
    id: 1,
    kind: "SET_COOLOFF",
    fields: { seconds: "120" },
    readyAt: T + 300,
    expiresAt: T + 2100,
    proposer: "0x1",
    approver: null,
    keyEpoch: 1,
    status: "PENDING",
    needsApproval: true,
  };
  it("needs a guardian, then waits, then can apply", () => {
    expect(changePhaseOf(c, state, T).word).toBe("Needs approval");
    expect(changePhaseOf({ ...c, approver: "0x2" }, state, T).word).toBe("Waiting");
    expect(changePhaseOf({ ...c, approver: "0x2" }, state, T + 301).canApply).toBe(true);
  });
  it("dies when keys change", () => {
    expect(changePhaseOf({ ...c, approver: "0x2" }, { keyEpoch: 2 }, T + 301).canApply).toBe(false);
  });
});
