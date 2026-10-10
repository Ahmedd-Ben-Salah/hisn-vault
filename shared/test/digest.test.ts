import { describe, it, expect } from "vitest";
import { Wallet, SigningKey } from "ethers";
import vectors from "../test-vectors.json";
import { payDigest, ethSignedHash, recoverSigner, completeSignature, TAG } from "../src/digest";
import { parseUnits, formatAmount, hbarToWei } from "../src/units";
import { predictTier, Tier } from "../src/vault";

const ctx = { chainId: vectors.chainId, vault: vectors.vault };

describe("digest vectors", () => {
  it("tag matches", () => {
    expect(vectors.tag).toBe(TAG);
  });

  it("PAY is 9 words", () => {
    const c = vectors.cases.find((x) => x.name === "pay_usdc_100")!;
    expect(c.wordCount).toBe(9);
    const d = payDigest(ctx, {
      to: c.fields.to!,
      token: c.fields.token!,
      amount: BigInt(c.fields.amount!),
      nonce: BigInt(c.fields.nonce!),
      deadline: BigInt(c.fields.deadline!),
    });
    expect(d).toBe(c.digest);
  });

  it("every case recovers its signer", () => {
    for (const c of vectors.cases) {
      expect(ethSignedHash(c.digest)).toBe(c.ethSignedHash);
      const signer = vectors.keys[c.signer as keyof typeof vectors.keys].address;
      expect(recoverSigner(c.digest, c.signature.serialized)).toBe(signer);
    }
  });

  it("completeSignature finds v and normalises high s", () => {
    const c = vectors.cases[0];
    const signer = vectors.keys.puck.address;
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const highS = "0x" + (N - BigInt(c.signature.s)).toString(16).padStart(64, "0");
    expect(completeSignature(c.digest, c.signature.r, highS, signer)).toBe(c.signature.serialized);
    expect(completeSignature(c.digest, c.signature.r, c.signature.s, Wallet.createRandom().address)).toBeNull();
  });

  it("one changed byte gives a different signer", () => {
    const c = vectors.cases[0];
    const d = payDigest(ctx, {
      to: c.fields.to!,
      token: c.fields.token!,
      amount: BigInt(c.fields.amount!) + 1n,
      nonce: BigInt(c.fields.nonce!),
      deadline: BigInt(c.fields.deadline!),
    });
    expect(recoverSigner(d, c.signature.serialized)).not.toBe(vectors.keys.puck.address);
    expect(new SigningKey(vectors.keys.puck.privateKey).compressedPublicKey).toBeTruthy();
  });
});

describe("units", () => {
  it("parses and formats", () => {
    expect(parseUnits("100", 6)).toBe(100_000_000n);
    expect(parseUnits("0.5", 8)).toBe(50_000_000n);
    expect(formatAmount(100_000_000n, 6)).toBe("100.00");
    expect(hbarToWei("1")).toBe(10n ** 18n);
  });
});

describe("tier prediction", () => {
  const limits = { instantMax: 50n, waitMax: 500n, dailyCap: 100n, agentDailyMax: 20n };
  const base = { isPayee: true, pastProbation: true, vaultBalance: 10_000n, instantSpent2d: 0n, waitQueued2d: 0n, limits };
  it("boundaries", () => {
    expect(predictTier({ ...base, amount: 50n })).toBe(Tier.INSTANT);
    expect(predictTier({ ...base, amount: 51n })).toBe(Tier.WAIT);
    expect(predictTier({ ...base, amount: 500n })).toBe(Tier.WAIT);
    expect(predictTier({ ...base, amount: 501n })).toBe(Tier.APPROVAL);
    expect(predictTier({ ...base, amount: 10n, isPayee: false })).toBe(Tier.WAIT);
    expect(predictTier({ ...base, amount: 400n, isPayee: false, vaultBalance: 700n })).toBe(Tier.APPROVAL);
    expect(predictTier({ ...base, amount: 40n, instantSpent2d: 70n })).toBe(Tier.WAIT);
  });
});
