import { describe, it, expect } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import { PQ_LEN, PqKeyTree, decodePqSignature, encodePqSignature, pqDigits, pqMessage, pqRecoverRoot, pqVerify } from "../src/pq";

const ctx = { chainId: 296, vault: "0x00000000000000000000000000000000000a61b5" };
const seed = keccak256(toUtf8Bytes("test puck seed"));
const tree = new PqKeyTree(seed, 4);
const digest = keccak256(toUtf8Bytes("pay 100 USDC"));

describe("hash-based one-time signatures", () => {
  it("checksum digits make every signature length 67", () => {
    const d = pqDigits(pqMessage(ctx, 0, digest));
    expect(d.length).toBe(PQ_LEN);
    expect(d.every((x) => x >= 0 && x < 16)).toBe(true);
  });

  it("a signature verifies against the root, for every leaf", () => {
    for (let leaf = 0; leaf < tree.capacity; leaf++) {
      const sig = tree.sign(ctx, digest, leaf);
      expect(pqVerify(ctx, digest, sig, tree.root)).toBe(true);
    }
  });

  it("round-trips through the ABI encoding", () => {
    const sig = tree.sign(ctx, digest, 3);
    expect(pqVerify(ctx, digest, decodePqSignature(encodePqSignature(sig)), tree.root)).toBe(true);
  });

  it("rejects a different digest, vault, chain or leaf", () => {
    const sig = tree.sign(ctx, digest, 5);
    expect(pqVerify(ctx, keccak256(toUtf8Bytes("pay 9999 USDC")), sig, tree.root)).toBe(false);
    expect(pqVerify({ ...ctx, vault: "0x00000000000000000000000000000000000a61b6" }, digest, sig, tree.root)).toBe(false);
    expect(pqVerify({ ...ctx, chainId: 295 }, digest, sig, tree.root)).toBe(false);
    expect(pqVerify(ctx, digest, { ...sig, leaf: 6 }, tree.root)).toBe(false);
  });

  it("rejects a tampered chain value or path", () => {
    const sig = tree.sign(ctx, digest, 7);
    const chains = [...sig.chains];
    chains[10] = keccak256(chains[10]);
    expect(pqVerify(ctx, digest, { ...sig, chains }, tree.root)).toBe(false);
    const path = [...sig.path];
    path[0] = keccak256(path[0]);
    expect(pqVerify(ctx, digest, { ...sig, path }, tree.root)).toBe(false);
    expect(pqRecoverRoot(ctx, digest, { ...sig, chains: chains.slice(1) })).toBeNull();
  });

  it("a different seed gives a different root", () => {
    expect(new PqKeyTree(keccak256(toUtf8Bytes("other")), 4).root).not.toBe(tree.root);
  });
});
