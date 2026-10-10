import { afterEach, describe, expect, it, vi } from "vitest";
import { Interface, type InterfaceAbi } from "ethers";
import vaultJson from "../../shared/abi/HisnVault.json";
import { readView } from "./chain";
import { focusPayment } from "./config";
import { STATUS } from "./model";

const iface = new Interface(((vaultJson as { abi?: InterfaceAbi }).abi ?? vaultJson) as InterfaceAbi);
const vault = "0x00000000000000000000000000000000004a3f21";
const cfg = { vault, relayer: "", relayerToken: "", owner: "Amel" };
const me = "0x00000000000000000000000000000000000000aa";
const sami = "0x00000000000000000000000000000000000000b5";

function payment(status: number): unknown[] {
  return [sami, "0x0000000000000000000000000000000000000000", 100_000_000n, 1n, 2n, 3n, 4n, 0n, 1n, BigInt(status), true, "0x0000000000000000000000000000000000000000"];
}

function fakeMirror(payments: Record<string, number>, pendingIds: bigint[]) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { data } = JSON.parse(String(init.body)) as { data: string };
    const tx = iface.parseTransaction({ data })!;
    asked.push(tx.name === "getPayment" ? `getPayment(${tx.args[0]})` : tx.name);
    const values: Record<string, () => unknown[]> = {
      getPendingIds: () => [pendingIds],
      epoch: () => [0n],
      keyEpoch: () => [0n],
      frozenUntil: () => [0n],
      lastFreezer: () => ["0x0000000000000000000000000000000000000000"],
      roleOf: () => [2n],
      changeCount: () => [0n],
      payeeSince: () => [0n],
      getPayment: () => [payment(payments[String(tx.args[0])] ?? STATUS.NONE)],
    };
    const result = iface.encodeFunctionResult(tx.name, values[tx.name]());
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
  return asked;
}

describe("opening the page on one payment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the payment number from the link", () => {
    expect(focusPayment("?payment=7")).toBe(7n);
    expect(focusPayment("?vault=x&payment= 12 ")).toBe(12n);
    expect(focusPayment("?payment=0")).toBeNull();
    expect(focusPayment("?payment=7abc")).toBeNull();
    expect(focusPayment("?payment=-1")).toBeNull();
    expect(focusPayment("")).toBeNull();
  });

  it("does not read anything extra when the linked payment is still waiting", async () => {
    const asked = fakeMirror({ "7": STATUS.PENDING }, [7n]);
    const v = await readView(cfg, me, 7n);
    expect(v.pending.map((p) => p.id)).toEqual([7n]);
    expect(v.gone).toBeUndefined();
    expect(asked.filter((a) => a === "getPayment(7)")).toHaveLength(1);
  });

  it("reports a linked payment that already left", async () => {
    fakeMirror({ "5": STATUS.EXECUTED, "7": STATUS.PENDING }, [7n]);
    const v = await readView(cfg, me, 5n);
    expect(v.pending.map((p) => p.id)).toEqual([7n]);
    expect(v.gone).toMatchObject({ id: 5n, status: STATUS.EXECUTED, to: sami, amount: 100_000_000n });
  });

  it("reports a linked payment that does not exist", async () => {
    fakeMirror({}, []);
    const v = await readView(cfg, me, 99n);
    expect(v.gone?.status).toBe(STATUS.NONE);
  });
});
