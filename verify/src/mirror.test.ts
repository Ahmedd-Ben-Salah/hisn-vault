import { afterEach, describe, expect, it, vi } from "vitest";
import deployment from "../../deployments/testnet.json";
import { Mirror, buildStories, cmp, decodeMessage, forVault, iface, parseLogs, readRelease, wanted, type LogLine, type MirrorLog } from "./mirror";

const vault = "0xf05B6cF51213a491c88B68EE539E7eD2E7AFbd5c";
const puck = "0xb927cf953e5991710E8a26a8FbeD6eFF9B796Faf";
const guardian = "0x946c7b308D0F46e2A24e9b58005362C014Bd1913";
const relayer = "0x5c07d211ecd215e70409ba916c6b8f6f83d3802f";
const sami = "0xF4C9E925D3029D59E05a4AA315AbF82B9642831f";
const usdc = "0x0000000000000000000000000000000000a61b55";
const schedule = "0x0000000000000000000000000000000000a63f16";

let n = 0;
function log(name: string, args: unknown[], at: string): MirrorLog {
  const ev = iface.getEvent(name)!;
  const { data, topics } = iface.encodeEventLog(ev, args);
  return { data, topics, timestamp: at, transaction_hash: `0x${(++n).toString(16).padStart(64, "0")}` };
}

function line(seq: number, at: string, type: string, ref: number, v = vault): LogLine {
  return { seq, at, msg: { v: 1, type: type as never, vault: v, ref, at: 0, body: {} } };
}

describe("payments rebuilt from the vault's events", () => {
  const logs = [
    log("Proposed", [2n, sami, usdc, 100_000_000n, 1n, 1000n, 940n], "1791280900.000000001"),
    log("Confirmed", [2n, relayer, schedule], "1791280943.5"),
    log("Executed", [2n, sami, usdc, 100_000_000n, "0x000000000000000000000000000000000000016b"], "1791280968.087983208"),
    log("Proposed", [3n, sami, usdc, 120_000_000n, 1n, 1100n, 1040n], "1791281000.1"),
    log("Vetoed", [3n, guardian], "1791281010.1"),
    log("Proposed", [4n, sami, usdc, 1_194_000_000n, 2n, 1200n, 1140n], "1791281100.1"),
    log("Confirmed", [4n, guardian, schedule], "1791281105.1"),
    log("Deposited", [puck, 5n], "1791281200.1"),
  ].reverse();

  it("parses the vault's logs in consensus order and skips other events cleanly", () => {
    const ev = parseLogs([...logs, { data: "0x", topics: ["0x" + "ab".repeat(32)], timestamp: "1.0", transaction_hash: "0x01" }]);
    expect(ev.map((e) => e.name)).toEqual(["Proposed", "Confirmed", "Executed", "Proposed", "Vetoed", "Proposed", "Confirmed", "Deposited"]);
    expect(ev[0].args.amount).toBe(100_000_000n);
  });

  it("tells a second yes on the puck from a guardian's approval, and keeps outcomes", () => {
    const stories = buildStories(parseLogs(logs), [line(18, "1791280910.2", "ALERT_ACK", 2), line(19, "1791280911.2", "ALERT_ACK", 2), line(20, "1791280912.2", "ALERT_ACK", 9)], [guardian]);
    expect(stories.map((s) => [s.id, s.outcome])).toEqual([
      [4, "waiting"],
      [3, "vetoed"],
      [2, "executed"],
    ]);
    const two = stories.find((s) => s.id === 2)!;
    expect(two.steps.map((s) => s.kind)).toEqual(["proposed", "alerted", "confirmed", "executed"]);
    expect(two.steps[1].seq).toBe(18);
    expect(two.schedule).toBe("0.0.10895126");
    expect(two.executedAt).toBe("1791280968.087983208");
    expect(stories.find((s) => s.id === 4)!.steps.map((s) => s.kind)).toEqual(["proposed", "approved"]);
    expect(stories.find((s) => s.id === 3)!.steps[1]).toMatchObject({ kind: "vetoed", by: guardian });
  });
});

describe("the public log", () => {
  it("decodes base64 messages and keeps only this vault's lines", () => {
    const raw = btoa(JSON.stringify({ v: 1, type: "AGENT_REFUSED", vault: vault.toLowerCase(), ref: 0, at: 5, body: { reason: "RedFlags" } }));
    expect(decodeMessage(raw)?.type).toBe("AGENT_REFUSED");
    expect(decodeMessage(btoa("not json"))).toBeNull();
    const lines = [line(1, "1.0", "PROPOSED", 1), line(2, "2.0", "PROPOSED", 1, "0x0000000000000000000000000000000000000001"), { seq: 3, at: "3.0", msg: null }];
    expect(forVault(lines, vault).map((l) => l.seq)).toEqual([1]);
  });

  it("orders consensus timestamps by seconds then nanoseconds", () => {
    expect(["10.5", "9.999999999", "10.000000001"].sort(cmp)).toEqual(["9.999999999", "10.000000001", "10.5"]);
  });
});

describe("where the page reads from", () => {
  it("uses the deployed vault unless the link names another", () => {
    expect(wanted("")).toMatchObject({ vault: deployment.vaultId, topic: deployment.topicId });
    expect(wanted("?vault=0.0.99&topic=0.0.100")).toMatchObject({ vault: "0.0.99", topic: "0.0.100" });
  });
});

describe("who released a payment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the release transaction and its schedule from the mirror node", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const body = url.includes("/schedules/")
        ? { executed_timestamp: "1791280968.087983208", payer_account_id: "0.0.10887434" }
        : { transactions: [{ transaction_id: "0.0.7314364-1791280943-955008558", consensus_timestamp: "1791280968.087983208", scheduled: true, result: "SUCCESS", entity_id: "0.0.10887434" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const story = { id: 2, schedule: "0.0.10887475", executedAt: "1791280968.087983208" } as never;
    const r = await readRelease(new Mirror("https://mirror.test"), story);
    expect(r).toEqual({ txId: "0.0.7314364-1791280943-955008558", scheduled: true, result: "SUCCESS", payer: "0.0.10887434", scheduleExecuted: "1791280968.087983208" });
    expect(asked).toEqual(["https://mirror.test/api/v1/transactions?timestamp=1791280968.087983208", "https://mirror.test/api/v1/schedules/0.0.10887475"]);
  });

  it("does not ask about payments that never left", async () => {
    expect(await readRelease(new Mirror("https://mirror.test"), { executedAt: null } as never)).toBeNull();
  });
});
