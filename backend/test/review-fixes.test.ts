import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { assertConfig } from "../src/config-check.js";
import { Flows, guardianFacts, previewReasons, type PreviewInput } from "../src/flows.js";
import type { PaymentView } from "../src/shared.js";

describe("config", () => {
  it("requires an API token in testnet mode only", () => {
    expect(() => assertConfig({ mode: "testnet", apiToken: "" })).toThrow(/RELAYER_API_TOKEN/);
    expect(() => assertConfig({ mode: "testnet", apiToken: "secret" })).not.toThrow();
    expect(() => assertConfig({ mode: "local", apiToken: "" })).not.toThrow();
  });
});

const PUCK = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function makeFlows() {
  const requests = new Map<number, Record<string, unknown>>([[1, { reqId: 1, status: "waiting_puck", to: OTHER, token: OTHER, amount: "1", source: "dashboard" }]]);
  const saved: Record<string, unknown>[] = [];
  const db = { getRequest: (id: number) => requests.get(id), saveRequest: (r: Record<string, unknown>) => saved.push(r) };
  const idx = Object.assign(new EventEmitter(), { roles: { puck: PUCK, guardians: [], watchers: [] }, payments: new Map(), changes: new Map(), state: null });
  const hub = Object.assign(new EventEmitter(), { send: () => true, toRole: () => 0 });
  const cfg = { chainId: 296, vault: "0x3333333333333333333333333333333333333333" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new Flows(cfg as any, db as any, {} as any, idx as any, {} as any, hub as any);
  return { hub, saved };
}

describe("rejected from the device hub", () => {
  it("ignores a rejection from a puck-role device that is not the vault's puck", async () => {
    const { hub, saved } = makeFlows();
    hub.emit("message", { id: "x", role: "puck", address: OTHER }, { t: "rejected", reqId: 1 });
    hub.emit("message", { id: "y", role: "puck", address: "" }, { t: "rejected", reqId: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toHaveLength(0);
  });

  it("accepts a rejection from the vault's current puck", async () => {
    const { hub, saved } = makeFlows();
    hub.emit("message", { id: "p", role: "puck", address: PUCK }, { t: "rejected", reqId: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(saved[0]?.status).toBe("rejected");
  });
});

describe("previewReasons", () => {
  const base: PreviewInput = {
    amount: 10n, since: 1000, probation: 100, now: 5000,
    instantMax: 50n, waitMax: 500n, dailyCap: 100n, instantUsed: 0n, waitUsed: 0n, spendable: 1000n,
  };
  it("explains an instant payment to a saved payee", () => {
    expect(previewReasons(base)).toEqual(["saved_small"]);
  });
  it("flags a new recipient and more than half the balance", () => {
    expect(previewReasons({ ...base, since: 0, amount: 600n })).toEqual(["new_recipient", "over_half_balance"]);
  });
  it("flags probation, instant max, daily cap and wait max", () => {
    expect(previewReasons({ ...base, now: 1050 })).toEqual(["on_probation"]);
    expect(previewReasons({ ...base, amount: 60n })).toEqual(["over_instant_max"]);
    expect(previewReasons({ ...base, instantUsed: 95n })).toEqual(["over_daily_cap"]);
    expect(previewReasons({ ...base, amount: 600n, spendable: 10_000n })).toEqual(["over_instant_max", "over_wait_max"]);
  });
});

function pay(id: number, o: Partial<PaymentView>): PaymentView {
  return {
    id, to: OTHER, token: "0x0000000000000000000000000000000000000000", amount: "100", tier: "WAIT", status: "EXECUTED",
    proposedAt: 1000, releaseAt: 0, confirmFrom: 0, expiresAt: 0, epoch: 0, confirmed: true, schedule: null,
    label: null, newRecipient: false, txs: { proposed: "0xabc" }, ...o,
  };
}

describe("guardianFacts", () => {
  const now = 1_000_000;
  it("reports never_paid, own_device and no comparison without history", () => {
    const p = pay(1, { status: "PENDING", proposedAt: now - 10 });
    expect(guardianFacts(p, [p], now).facts).toEqual(["never_paid", "own_device"]);
  });
  it("reports times_usual and nth_this_week", () => {
    const old = [pay(1, { amount: "100", proposedAt: now - 100 }), pay(2, { amount: "100", proposedAt: now - 30 * 86400 })];
    const p = pay(3, { status: "PENDING", amount: "500", proposedAt: now - 5 });
    const r = guardianFacts(p, [...old, p], now);
    expect(r.facts).toEqual(["times_usual", "own_device", "nth_this_week"]);
    expect(r.timesUsual).toBe(5);
    expect(r.weekCount).toBe(2);
  });
});
