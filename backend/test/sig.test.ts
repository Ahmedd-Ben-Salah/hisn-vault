import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { finishSignature } from "../src/sig.js";
import { vetoDigest, ethSignedHash, recoverSigner } from "../src/shared.js";

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ctx = { chainId: 296, vault: "0x00000000000000000000000000000000000a11ce" };

describe("finishSignature", () => {
  const g = Wallet.createRandom();
  const other = Wallet.createRandom();
  const digest = vetoDigest(ctx, 7n);
  const sig = g.signingKey.sign(ethSignedHash(digest));

  it("finds v from r and s alone, as the ESP32 sends them", () => {
    const f = finishSignature(digest, { r: sig.r, s: sig.s }, [other.address, g.address]);
    expect(f?.signer).toBe(g.address);
    expect(recoverSigner(digest, f!.sig)).toBe(g.address);
  });

  it("flips a high s into the lower half", () => {
    const high = "0x" + (N - BigInt(sig.s)).toString(16).padStart(64, "0");
    const f = finishSignature(digest, { r: sig.r, s: high }, [g.address]);
    expect(f).not.toBeNull();
    expect(BigInt("0x" + f!.sig.slice(66, 130)) <= N / 2n).toBe(true);
  });

  it("accepts a full 65-byte signature from the guardian page", () => {
    const f = finishSignature(digest, { sig: sig.serialized }, [g.address]);
    expect(f?.signer).toBe(g.address);
  });

  it("rejects a key that is not allowed", () => {
    expect(finishSignature(digest, { r: sig.r, s: sig.s }, [other.address])).toBeNull();
  });

  it("rejects a signature for another payment", () => {
    expect(finishSignature(vetoDigest(ctx, 8n), { r: sig.r, s: sig.s }, [g.address])).toBeNull();
  });

  it("rejects garbage", () => {
    expect(finishSignature(digest, { sig: "0x1234" }, [g.address])).toBeNull();
    expect(finishSignature(digest, {}, [g.address])).toBeNull();
  });
});
