import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@hisn/shared";
import { windowsFor } from "./windows";

const USDC = "0x0000000000000000000000000000000000068cDa";
const NOW = 1_800_000_000;

function agentPaid(amount: string, at: number, token = USDC): TimelineEntry {
  return { kind: "hcs", name: "AGENT_PAID", at, verified: true, hcs: { v: 1, type: "AGENT_PAID", ref: 0, body: { to: "0x1", token, amount } } } as unknown as TimelineEntry;
}

describe("helper allowance from the public log", () => {
  it("adds helper payments from today and yesterday only", () => {
    const log = [agentPaid("12000000", NOW - 60), agentPaid("3000000", NOW - 86400), agentPaid("9000000", NOW - 3 * 86400)];
    expect(windowsFor([], USDC, NOW, log).agent).toBe(15_000_000n);
  });

  it("ignores other tokens and other message types", () => {
    const other = { ...agentPaid("5000000", NOW), name: "AgentPaid", kind: "event", hcs: undefined } as TimelineEntry;
    expect(windowsFor([], USDC, NOW, [agentPaid("7", NOW, "0x0000000000000000000000000000000000000000"), other]).agent).toBe(0n);
  });
});
