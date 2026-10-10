import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deploy, U, H, HBAR } from "./fixture";

const fx = () => deploy();

describe("HisnVault: WAIT, reconfirm and the network timer", () => {
  it("stores a WAIT payment with no timer", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    expect(r.tier).to.equal(1);
    const p = await f.vault.getPayment(r.id);
    expect(p.status).to.equal(1);
    expect(p.confirmed).to.equal(false);
    expect(p.schedule).to.equal(ethers.ZeroAddress);
    expect(await f.hss.count()).to.equal(0n);
  });

  it("never releases an unconfirmed WAIT payment", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(61);
    await expect(f.vault.execute(r.id)).to.be.revertedWithCustomError(f.vault, "NotConfirmed");
    await time.increase(1800);
    await expect(f.vault.execute(r.id)).to.be.revertedWithCustomError(f.vault, "Expired_");
    await f.vault.expire(r.id);
    expect((await f.vault.getPayment(r.id)).status).to.equal(5);
    expect(await f.usdc.balanceOf(f.stranger.address)).to.equal(0n);
  });

  it("refuses reconfirm before half the cool-off", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await expect(f.vault.reconfirm(...(await f.reconfirmArgs(r.id)))).to.be.revertedWithCustomError(f.vault, "TooEarly");
  });

  it("refuses reconfirm signed by anyone but the puck", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(31);
    await expect(f.vault.reconfirm(...(await f.reconfirmArgs(r.id, f.g1)))).to.be.revertedWithCustomError(
      f.vault,
      "BadSignature",
    );
  });

  it("reconfirm schedules execute, and the timer releases it", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(31);
    await expect(f.vault.reconfirm(...(await f.reconfirmArgs(r.id)))).to.emit(f.vault, "Confirmed");
    const p = await f.vault.getPayment(r.id);
    expect(p.confirmed).to.equal(true);
    expect(p.schedule).to.not.equal(ethers.ZeroAddress);
    const s = await f.hss.scheds(p.schedule);
    expect(s.when).to.equal(p.releaseAt + 5n);
    await expect(f.vault.execute(r.id)).to.be.revertedWithCustomError(f.vault, "TooEarly");
    await time.increaseTo(s.when);
    await expect(f.hss.fire(p.schedule)).to.emit(f.vault, "Executed").withArgs(r.id, f.stranger.address, f.usdcAddr, U(100), ethers.getAddress(await f.hss.getAddress()));
    expect(await f.usdc.balanceOf(f.stranger.address)).to.equal(U(100));
    expect((await f.vault.getPayment(r.id)).status).to.equal(2);
    expect((await f.vault.getPendingIds()).length).to.equal(0);
  });

  it("pays at once if reconfirmed after the release time", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(120);
    await expect(f.vault.reconfirm(...(await f.reconfirmArgs(r.id)))).to.emit(f.vault, "Executed");
    expect(await f.usdc.balanceOf(f.stranger.address)).to.equal(U(100));
  });

  it("tries the next seconds when one is busy", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    const p0 = await f.vault.getPayment(r.id);
    await f.hss.setBusySecond(p0.releaseAt + 5n);
    await time.increase(31);
    await f.vault.reconfirm(...(await f.reconfirmArgs(r.id)));
    const p = await f.vault.getPayment(r.id);
    expect((await f.hss.scheds(p.schedule)).when).to.equal(p0.releaseAt + 6n);
  });

  it("emits ScheduleFailed and allows a manual execute when the timer refuses", async () => {
    const f = await loadFixture(fx);
    await f.hss.setFailAll(true);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(31);
    await expect(f.vault.reconfirm(...(await f.reconfirmArgs(r.id)))).to.emit(f.vault, "ScheduleFailed").withArgs(r.id);
    await time.increase(30);
    await expect(f.vault.connect(f.stranger).execute(r.id)).to.emit(f.vault, "Executed");
  });

  it("lets the puck cancel and gives the waiting amount back", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(400));
    expect((await f.vault.windows(f.usdcAddr)).wait2d).to.equal(U(400));
    await f.vault.cancel(r.id, await f.cancelSig(r.id));
    expect((await f.vault.windows(f.usdcAddr)).wait2d).to.equal(0n);
    expect((await f.vault.getPayment(r.id)).status).to.equal(4);
  });

  it("pushes WAIT payments over waitMax into APPROVAL", async () => {
    const f = await loadFixture(fx);
    await f.propose(f.stranger.address, f.usdcAddr, U(300));
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(300));
    expect(r.tier).to.equal(2);
  });

  it("blocks reentrancy from a malicious receiver", async () => {
    const evil = await (await ethers.getContractFactory("EvilReceiver")).deploy();
    const addr = await evil.getAddress();
    const f = await deploy({ extraPayees: [addr] });
    const a = await f.propose(addr, HBAR, H(60));
    const b = await f.propose(addr, HBAR, H(60));
    await time.increase(31);
    await f.vault.reconfirm(...(await f.reconfirmArgs(a.id)));
    await f.vault.reconfirm(...(await f.reconfirmArgs(b.id)));
    await evil.arm(await f.vault.getAddress(), b.id);
    await time.increase(40);
    await f.vault.execute(a.id);
    expect(await evil.lastReentryOk()).to.equal(false);
    expect((await f.vault.getPayment(b.id)).status).to.equal(1);
    await f.vault.execute(b.id);
    expect((await f.vault.getPayment(b.id)).status).to.equal(2);
  });
});
