import { afterEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import { approveDigest, changeVetoDigest, freezeDigest, recoverSigner, vetoDigest } from "@hisn/shared";
import { liveActions } from "./chain";
import type { Chg, Pay, View } from "./model";

const vault = "0x00000000000000000000000000000000004a3f21";
const ctx = { chainId: 296n, vault };
const wallet = new Wallet(Wallet.createRandom().privateKey);
const cfg = { vault, relayer: "http://relayer.test", relayerToken: "t0ken", owner: "Amel" };

const pay = { id: 7n } as Pay;
const view = { epoch: 4, frozenUntil: 0 } as View;

function captureFetch() {
  const calls: Array<{ url: string; body: Record<string, string>; auth: string | undefined }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization });
    return new Response(JSON.stringify({ tx: "0.0.1@1.2" }), { status: 200 });
  });
  return calls;
}

describe("guardian page signatures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs the exact veto digest and sends it to the relayer first", async () => {
    const calls = captureFetch();
    const done = await liveActions(cfg, wallet, () => view).stop(pay);
    expect(done).toEqual({ path: "relayer", tx: "0.0.1@1.2" });
    expect(calls[0].url).toBe("http://relayer.test/relay/veto");
    expect(calls[0].auth).toBe("Bearer t0ken");
    expect(calls[0].body.paymentId).toBe("7");
    expect(recoverSigner(vetoDigest(ctx, 7n), calls[0].body.sig)).toBe(wallet.address);
  });

  it("signs approve and freeze for the current epoch", async () => {
    const calls = captureFetch();
    const act = liveActions(cfg, wallet, () => view);
    await act.approve(pay);
    await act.freeze();
    expect(recoverSigner(approveDigest(ctx, 7n), calls[0].body.sig)).toBe(wallet.address);
    expect(calls[1].body.epoch).toBe("4");
    expect(recoverSigner(freezeDigest(ctx, 4n), calls[1].body.sig)).toBe(wallet.address);
  });

  it("signs a change veto for the right change id", async () => {
    const calls = captureFetch();
    await liveActions(cfg, wallet, () => view).stopChange({ id: 3n } as Chg);
    expect(calls[0].url).toBe("http://relayer.test/relay/change/3/veto");
    expect(recoverSigner(changeVetoDigest(ctx, 3n), calls[0].body.sig)).toBe(wallet.address);
  });
});
