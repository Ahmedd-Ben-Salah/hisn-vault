import { describe, expect, it } from "vitest";
import { changeFieldsFrom, HttpError } from "../src/flows.js";
import { ChangeKind, encodeChangeData, decodeChangeData } from "../src/shared.js";

describe("changeFieldsFrom", () => {
  it("builds limits that round-trip through the vault encoding", () => {
    const f = changeFieldsFrom(ChangeKind.SET_LIMITS, {
      token: "0x0000000000000000000000000000000000068cda",
      instantMax: "50000000",
      waitMax: "500000000",
      dailyCap: "100000000",
      agentDailyMax: "20000000",
    });
    const back = decodeChangeData(ChangeKind.SET_LIMITS, encodeChangeData(f)) as { instantMax: bigint; token: string };
    expect(back.instantMax).toBe(50_000_000n);
    expect(back.token).toBe("0x0000000000000000000000000000000000068cDa");
  });

  it("refuses a bad address and a negative number", () => {
    expect(() => changeFieldsFrom(ChangeKind.ADD_PAYEE, { address: "nope" })).toThrow(HttpError);
    expect(() => changeFieldsFrom(ChangeKind.SET_COOLOFF, { seconds: "-1" })).toThrow(HttpError);
  });

  it("needs no fields to unfreeze", () => {
    expect(encodeChangeData(changeFieldsFrom(ChangeKind.UNFREEZE, {}))).toBe("0x");
  });
});
