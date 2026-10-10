import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { keccak256, toUtf8Bytes } from "ethers";
import { ChangeKind, PqKeyTree, changeDigest, encodeChangeData, encodePqSignature, payDigest, reconfirmDigest, Tier } from "@hisn/shared";
import { deploy, U } from "./fixture";

const tree = new PqKeyTree(keccak256(toUtf8Bytes("hardhat puck pq seed")), 4);

const pqFx = () => deploy({ pqRoot: tree.root, pqHeight: 4 });
const plainFx = () => deploy();

async function pqVault() {
  const f = await loadFixture(pqFx);
  let leaf = 0;
  const pqFor = (digest: string, l = leaf++) => encodePqSignature(tree.sign(f.ctx, digest, l));
  const payArgs = async (to: string, amount: bigint) => {
    const p = await f.signPay(to, f.usdcAddr, amount);
    const d = payDigest(f.ctx, { to: p.to, token: p.token, amount: p.amount, nonce: p.nonce, deadline: p.deadline });
    return { p, d };
  };
  return { ...f, pqFor, payArgs };
}

describe("post-quantum (hash-based) puck signatures", () => {
  it("stores the root and height", async () => {
    const f = await pqVault();
    expect(await f.vault.pqRoot()).to.equal(tree.root);
    expect(await f.vault.PQ_HEIGHT()).to.equal(4);
  });

  it("refuses the classical-only path once a root is set", async () => {
    const f = await pqVault();
    const { p } = await f.payArgs(f.payee.address, U(10));
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(f.vault, "PqRequired");
  });

  it("pays with ECDSA + hash-based signatures together", async () => {
    const f = await pqVault();
    const { p, d } = await f.payArgs(f.payee.address, U(10));
    await expect(f.vault.proposePQ(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig, f.pqFor(d)))
      .to.emit(f.vault, "PqSigned")
      .withArgs(0, 1);
    expect(await f.usdc.balanceOf(f.payee.address)).to.equal(U(10));
  });

  it("a valid ECDSA signature with a forged hash-based one fails (the quantum attacker case)", async () => {
    const f = await pqVault();
    const { p, d } = await f.payArgs(f.stranger.address, U(10));
    const sig = tree.sign(f.ctx, d, 0);
    sig.chains[3] = keccak256(sig.chains[3]);
    await expect(f.vault.proposePQ(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig, encodePqSignature(sig))).to.be.revertedWithCustomError(
      f.vault,
      "PqBadSignature",
    );
  });

  it("a hash-based signature for another payment cannot be reused", async () => {
    const f = await pqVault();
    const a = await f.payArgs(f.payee.address, U(1));
    const b = await f.payArgs(f.stranger.address, U(400));
    await expect(f.vault.proposePQ(b.p.to, b.p.token, b.p.amount, b.p.nonce, b.p.deadline, b.p.sig, f.pqFor(a.d, 5))).to.be.revertedWithCustomError(
      f.vault,
      "PqBadSignature",
    );
  });

  it("each one-time key works once", async () => {
    const f = await pqVault();
    const a = await f.payArgs(f.payee.address, U(1));
    await f.vault.proposePQ(a.p.to, a.p.token, a.p.amount, a.p.nonce, a.p.deadline, a.p.sig, f.pqFor(a.d, 2));
    const b = await f.payArgs(f.payee.address, U(1));
    await expect(f.vault.proposePQ(b.p.to, b.p.token, b.p.amount, b.p.nonce, b.p.deadline, b.p.sig, f.pqFor(b.d, 2))).to.be.revertedWithCustomError(
      f.vault,
      "PqLeafUsed",
    );
  });

  it("the second confirmation of a waiting payment also needs a hash-based signature", async () => {
    const f = await pqVault();
    const { p, d } = await f.payArgs(f.stranger.address, U(100));
    const tx = await f.vault.proposePQ(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig, f.pqFor(d));
    const ev = (await tx.wait())!.logs.map((l) => f.vault.interface.parseLog(l)).find((e) => e?.name === "Proposed")!;
    expect(Number(ev.args.tier)).to.equal(Tier.WAIT);
    const id = ev.args.id as bigint;
    await network.provider.send("evm_increaseTime", [31]);
    await network.provider.send("evm_mine");
    const [, nonce, deadline, sig] = await f.reconfirmArgs(id);
    await expect(f.vault.reconfirm(id, nonce, deadline, sig)).to.be.revertedWithCustomError(f.vault, "PqRequired");
    const rd = reconfirmDigest(f.ctx, id, nonce, deadline);
    await expect(f.vault.reconfirmPQ(id, nonce, deadline, sig, f.pqFor(rd))).to.emit(f.vault, "Confirmed");
  });

  it("settings changes need one too, and SET_PQ_ROOT rotates to fresh keys", async () => {
    const f = await pqVault();
    const next = new PqKeyTree(keccak256(toUtf8Bytes("next puck pq seed")), 4);
    const c = { kind: ChangeKind.SET_PQ_ROOT as const, root: next.root };
    const nonce = 900n;
    const deadline = (await f.now()) + 120n;
    const keyEpoch = BigInt(await f.vault.keyEpoch());
    const d = changeDigest(f.ctx, c, keyEpoch, nonce, deadline);
    const sig = await f.sign(f.puck, d);
    await expect(f.vault.proposeChange(c.kind, encodeChangeData(c), nonce, deadline, sig)).to.be.revertedWithCustomError(f.vault, "PqRequired");
    await f.vault.proposeChangePQ(c.kind, encodeChangeData(c), nonce, deadline, sig, f.pqFor(d));
    const id = await f.vault.changeCount();
    await f.vault.approveChange(id, await f.changeApproveSig(id, f.g1));
    await network.provider.send("evm_increaseTime", [301]);
    await network.provider.send("evm_mine");
    await expect(f.vault.executeChange(id)).to.emit(f.vault, "PqRootSet").withArgs(next.root, 4);
    expect(await f.vault.pqUsed()).to.equal(0);
  });

  it("the vault rejects a hash-based signature made for another vault", async () => {
    const f = await pqVault();
    const { p, d } = await f.payArgs(f.payee.address, U(1));
    const other = encodePqSignature(tree.sign({ ...f.ctx, vault: f.stranger.address }, d, 9));
    await expect(f.vault.proposePQ(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig, other)).to.be.revertedWithCustomError(f.vault, "PqBadSignature");
  });

  it("without a root the vault keeps working with ECDSA alone (classical mode)", async () => {
    const f = await loadFixture(plainFx);
    const r = await f.propose(f.payee.address, f.usdcAddr, U(10));
    expect(r.tier).to.equal(Tier.INSTANT);
  });
});

describe("freeze cooldown", () => {
  it("the same guardian cannot freeze again right after its freeze ends", async () => {
    const f = await loadFixture(plainFx);
    await f.vault.freeze(await f.freezeSig(f.g1));
    await network.provider.send("evm_increaseTime", [601]);
    await network.provider.send("evm_mine");
    await expect(f.vault.freeze(await f.freezeSig(f.g1))).to.be.revertedWithCustomError(f.vault, "FreezeCooldown");
    await expect(f.vault.freeze(await f.freezeSig(f.g2))).to.emit(f.vault, "Frozen");
  });

  it("the owner's puck is never in cooldown", async () => {
    const f = await loadFixture(plainFx);
    await f.vault.freeze(await f.freezeSig(f.puck));
    await network.provider.send("evm_increaseTime", [601]);
    await network.provider.send("evm_mine");
    await expect(f.vault.freeze(await f.freezeSig(f.puck))).to.emit(f.vault, "Frozen");
  });
});

void ethers;
