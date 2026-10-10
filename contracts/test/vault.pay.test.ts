import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deploy, U, H, HBAR } from "./fixture";

const fx = () => deploy();

describe("HisnVault: propose and tiers", () => {
  it("pays a saved payee instantly", async () => {
    const f = await loadFixture(fx);
    const before = await f.usdc.balanceOf(f.payee.address);
    const r = await f.propose(f.payee.address, f.usdcAddr, U(20));
    expect(r.tier).to.equal(0);
    expect(await f.usdc.balanceOf(f.payee.address)).to.equal(before + U(20));
    const p = await f.vault.getPayment(r.id);
    expect(p.status).to.equal(2);
  });

  it("puts the tier boundaries in the right place", async () => {
    const f = await loadFixture(fx);
    expect(await f.vault.tierFor(f.payee.address, f.usdcAddr, U(50))).to.equal(0);
    expect(await f.vault.tierFor(f.payee.address, f.usdcAddr, U(50) + 1n)).to.equal(1);
    expect(await f.vault.tierFor(f.payee.address, f.usdcAddr, U(500))).to.equal(1);
    expect(await f.vault.tierFor(f.payee.address, f.usdcAddr, U(500) + 1n)).to.equal(2);
    expect(await f.vault.tierFor(f.stranger.address, f.usdcAddr, U(1))).to.equal(1);
  });

  it("sends more than half the vault to someone new to APPROVAL", async () => {
    const f = await loadFixture(fx);
    expect(await f.vault.tierFor(f.stranger.address, f.usdcAddr, U(400))).to.equal(1);
    await f.usdc.mint(f.stranger.address, 0n);
    const f2 = await deploy({ usdcFunding: U(700) });
    expect(await f2.vault.tierFor(f2.stranger.address, f2.usdcAddr, U(400))).to.equal(2);
    expect(await f2.vault.tierFor(f2.payee.address, f2.usdcAddr, U(400))).to.equal(1);
  });

  it("counts today plus yesterday for the instant cap", async () => {
    const f = await loadFixture(fx);
    const now = await time.latest();
    const nextMidnight = (Math.floor(now / 86400) + 1) * 86400;
    await time.increaseTo(nextMidnight - 30);
    await f.propose(f.payee.address, f.usdcAddr, U(50));
    await f.propose(f.payee.address, f.usdcAddr, U(50));
    await time.increaseTo(nextMidnight + 30);
    const r = await f.propose(f.payee.address, f.usdcAddr, U(10));
    expect(r.tier).to.equal(1);
  });

  it("rejects a replayed signature", async () => {
    const f = await loadFixture(fx);
    const p = await f.signPay(f.payee.address, f.usdcAddr, U(5));
    await f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig);
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "Replayed",
    );
  });

  it("rejects a deadline more than 600 s away", async () => {
    const f = await loadFixture(fx);
    const p = await f.signPay(f.payee.address, f.usdcAddr, U(5), f.puck, 3600n);
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "DeadlineTooFar",
    );
  });

  it("rejects an expired deadline", async () => {
    const f = await loadFixture(fx);
    const p = await f.signPay(f.payee.address, f.usdcAddr, U(5));
    await time.increase(200);
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "Expired_",
    );
  });

  it("rejects a signature from the wrong key and a changed amount", async () => {
    const f = await loadFixture(fx);
    const p = await f.signPay(f.payee.address, f.usdcAddr, U(5), f.g1);
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "BadSignature",
    );
    const q = await f.signPay(f.payee.address, f.usdcAddr, U(5));
    await expect(f.vault.propose(q.to, q.token, q.amount + 1n, q.nonce, q.deadline, q.sig)).to.be.revertedWithCustomError(
      f.vault,
      "BadSignature",
    );
  });

  it("rejects paying a guardian or watcher, an unknown token and zero", async () => {
    const f = await loadFixture(fx);
    const a = await f.signPay(f.g1.address, f.usdcAddr, U(5));
    await expect(f.vault.propose(a.to, a.token, a.amount, a.nonce, a.deadline, a.sig)).to.be.revertedWithCustomError(
      f.vault,
      "NotAllowed",
    );
    const b = await f.signPay(f.payee.address, f.stranger.address, U(5));
    await expect(f.vault.propose(b.to, b.token, b.amount, b.nonce, b.deadline, b.sig)).to.be.revertedWithCustomError(
      f.vault,
      "BadToken",
    );
    const c = await f.signPay(f.payee.address, f.usdcAddr, 0n);
    await expect(f.vault.propose(c.to, c.token, c.amount, c.nonce, c.deadline, c.sig)).to.be.revertedWithCustomError(
      f.vault,
      "ZeroAmount",
    );
  });

  it("refuses the sixth waiting payment", async () => {
    const f = await loadFixture(fx);
    for (let i = 0; i < 5; i++) await f.propose(f.stranger.address, f.usdcAddr, U(10));
    const p = await f.signPay(f.stranger.address, f.usdcAddr, U(10));
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "TooManyPending",
    );
  });

  it("frees a pending slot once a payment has expired", async () => {
    const f = await loadFixture(fx);
    for (let i = 0; i < 5; i++) await f.propose(f.stranger.address, f.usdcAddr, U(10));
    await time.increase(60 + 1800 + 1);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(10));
    expect(r.tier).to.equal(1);
    expect((await f.vault.getPendingIds()).length).to.equal(1);
    expect((await f.vault.getPayment(1n)).status).to.equal(5);
  });

  it("moves HBAR and keeps the gas reserve", async () => {
    const f = await loadFixture(fx);
    const before = await ethers.provider.getBalance(f.payee.address);
    await f.propose(f.payee.address, HBAR, H(5));
    expect(await ethers.provider.getBalance(f.payee.address)).to.equal(before + H(5));
    const f2 = await deploy({ hbarFunding: H(12) });
    const p = await f2.signPay(f2.payee.address, HBAR, H(5));
    await expect(f2.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f2.vault,
      "BelowGasReserve",
    );
  });

  it("reverts and keeps nothing when the receiver refuses", async () => {
    const f = await loadFixture(fx);
    const bad = await (await ethers.getContractFactory("RevertingReceiver")).deploy();
    const addr = await bad.getAddress();
    const f2 = await deploy({ extraPayees: [addr] });
    const p = await f2.signPay(addr, HBAR, H(1));
    await expect(f2.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f2.vault,
      "TransferFailed",
    );
    expect(f.vault).to.exist;
  });
});
