import { describe, expect, it } from "vitest";
import { DEMO_USDC, HBAR, USDC_TESTNET } from "@hisn/shared";
import { amount, clock, money, registerUsdc, toRaw } from "./format";
import { windowsFor } from "./windows";

describe("format", () => {
  it("groups thousands and keeps two places", () => {
    expect(amount("1240500000", USDC_TESTNET)).toBe("1,240.50");
    expect(money("53210000000", HBAR)).toBe("532.10 HBAR");
    expect(money("50000000", USDC_TESTNET, 0)).toBe("50 USDC");
  });
  it("parses user input into raw units", () => {
    expect(toRaw("100", USDC_TESTNET)).toBe(100_000_000n);
    expect(toRaw("1,000.5", HBAR)).toBe(100_050_000_000n);
    expect(toRaw("1.1234567", USDC_TESTNET)).toBeNull();
    expect(toRaw("abc", USDC_TESTNET)).toBeNull();
  });
  it("shows countdowns", () => {
    expect(clock(18)).toBe("0:18");
    expect(clock(1819)).toBe("30:19");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(-4)).toBe("0:00");
  });
});

describe("windowsFor", () => {
  it("counts today and yesterday only", () => {
    const now = 1_760_000_000;
    const day = 86400;
    const base = {
      to: "0x1",
      token: USDC_TESTNET,
      releaseAt: 0,
      confirmFrom: 0,
      expiresAt: 0,
      epoch: 1,
      confirmed: true,
      schedule: null,
      label: null,
      newRecipient: false,
      txs: {},
    };
    const w = windowsFor(
      [
        { ...base, id: 1, amount: "10", tier: "INSTANT", status: "EXECUTED", proposedAt: now },
        { ...base, id: 2, amount: "20", tier: "INSTANT", status: "EXECUTED", proposedAt: now - day },
        { ...base, id: 3, amount: "40", tier: "INSTANT", status: "EXECUTED", proposedAt: now - 3 * day },
        { ...base, id: 4, amount: "5", tier: "WAIT", status: "VETOED", proposedAt: now },
        { ...base, id: 5, amount: "7", tier: "WAIT", status: "PENDING", proposedAt: now },
        { ...base, id: 6, amount: "3", tier: "INSTANT", status: "EXECUTED", proposedAt: now, executedBy: "agent" },
      ],
      USDC_TESTNET,
      now,
    );
    expect(w).toEqual({ instant: 30n, waiting: 7n, agent: 3n });
  });
});

describe("testnet stand-in token", () => {
  it("is shown as USDC with six decimals", () => {
    expect(money("12000000", DEMO_USDC)).toBe("12.00 USDC");
    expect(toRaw("12.5", DEMO_USDC)).toBe(12_500_000n);
  });

  it("shows a token the vault declares as USDC", () => {
    const other = "0x00000000000000000000000000000000000b0b0b";
    expect(money("5000000", other)).toMatch(/TOKEN$/);
    registerUsdc(other);
    expect(money("5000000", other)).toBe("5.00 USDC");
  });
});
