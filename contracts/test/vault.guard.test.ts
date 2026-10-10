import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deploy, U } from "./fixture";

const fx = () => deploy();

describe("HisnVault: veto, approval, freeze", () => {
  it("watcher vetoes by signature, waiting total comes back, timer is deleted", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(31);
    await f.vault.reconfirm(...(await f.reconfirmArgs(r.id)));
    const sched = (await f.vault.getPayment(r.id)).schedule;
    await expect(f.vault.veto(r.id, await f.vetoSig(r.id, f.watcher)))
      .to.emit(f.vault, "Vetoed")
      .withArgs(r.id, f.watcher.address)
      .and.to.emit(f.vault, "ScheduleDeleted");
    expect((await f.hss.scheds(sched)).deleted).to.equal(true);
    expect((await f.vault.windows(f.usdcAddr)).wait2d).to.equal(0n);
    await time.increase(60);
    await expect(f.vault.execute(r.id)).to.be.revertedWithCustomError(f.vault, "NotPending");
    expect(await f.usdc.balanceOf(f.stranger.address)).to.equal(0n);
  });

  it("guardian vetoes directly from its own key", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await expect(f.vault.connect(f.g2).veto(r.id, "0x")).to.emit(f.vault, "Vetoed").withArgs(r.id, f.g2.address);
  });

  it("nobody else can veto", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await expect(f.vault.connect(f.stranger).veto(r.id, "0x")).to.be.revertedWithCustomError(f.vault, "NotGuardian");
    await expect(f.vault.veto(r.id, await f.vetoSig(r.id, f.puck))).to.be.revertedWithCustomError(f.vault, "NotGuardian");
  });

  it("a fired timer on a vetoed payment does nothing", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await time.increase(31);
    await f.vault.reconfirm(...(await f.reconfirmArgs(r.id)));
    const p = await f.vault.getPayment(r.id);
    await f.vault.connect(f.g1).veto(r.id, "0x");
    await time.increaseTo((await f.hss.scheds(p.schedule)).when);
    await expect(f.hss.fire(p.schedule)).to.be.revertedWith("deleted");
  });

  it("APPROVAL: a watcher cannot approve", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(1500));
    expect(r.tier).to.equal(2);
    await expect(f.vault.approve(r.id, await f.approveSig(r.id, f.watcher))).to.be.revertedWithCustomError(
      f.vault,
      "NotGuardian",
    );
    await expect(f.vault.connect(f.watcher).approve(r.id, "0x")).to.be.revertedWithCustomError(f.vault, "NotGuardian");
  });

  it("APPROVAL: nothing leaves without a guardian yes", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(1500));
    await time.increase(120);
    await expect(f.vault.execute(r.id)).to.be.revertedWithCustomError(f.vault, "NotConfirmed");
    await expect(f.vault.reconfirm(...(await f.reconfirmArgs(r.id)))).to.be.revertedWithCustomError(f.vault, "WrongTier");
  });

  it("APPROVAL: guardian yes during the cool-off schedules; timer releases", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(1500));
    await expect(f.vault.approve(r.id, await f.approveSig(r.id, f.g1)))
      .to.emit(f.vault, "Confirmed")
      .withArgs(r.id, f.g1.address, (s: string) => s !== ethers.ZeroAddress);
    const p = await f.vault.getPayment(r.id);
    await time.increaseTo((await f.hss.scheds(p.schedule)).when);
    await f.hss.fire(p.schedule);
    expect(await f.usdc.balanceOf(f.stranger.address)).to.equal(U(1500));
  });

  it("APPROVAL: guardian yes after the cool-off pays at once", async () => {
    const f = await loadFixture(fx);
    const r = await f.propose(f.stranger.address, f.usdcAddr, U(1500));
    await time.increase(90);
    await expect(f.vault.connect(f.g2).approve(r.id, "0x")).to.emit(f.vault, "Executed");
  });

  it("freeze cancels every waiting payment and blocks new ones", async () => {
    const f = await loadFixture(fx);
    const a = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    const b = await f.propose(f.stranger.address, f.usdcAddr, U(1500));
    await time.increase(31);
    await f.vault.reconfirm(...(await f.reconfirmArgs(a.id)));
    await expect(f.vault.freeze(await f.freezeSig(f.watcher))).to.emit(f.vault, "Frozen");
    expect((await f.vault.getPayment(a.id)).status).to.equal(4);
    expect((await f.vault.getPayment(b.id)).status).to.equal(4);
    expect((await f.vault.getPendingIds()).length).to.equal(0);
    const p = await f.signPay(f.payee.address, f.usdcAddr, U(5));
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "IsFrozen",
    );
  });

  it("a freeze ends by itself after FREEZE_MAX and old payments stay dead", async () => {
    const f = await loadFixture(fx);
    const a = await f.propose(f.stranger.address, f.usdcAddr, U(100));
    await f.vault.connect(f.g1).freeze("0x");
    await time.increase(601);
    expect(await f.vault.isFrozen()).to.equal(false);
    await expect(f.vault.execute(a.id)).to.be.revertedWithCustomError(f.vault, "NotPending");
    const r = await f.propose(f.payee.address, f.usdcAddr, U(5));
    expect(r.tier).to.equal(0);
  });

  it("an old freeze signature cannot be replayed", async () => {
    const f = await loadFixture(fx);
    const sig = await f.freezeSig(f.watcher);
    await f.vault.freeze(sig);
    await time.increase(601);
    await expect(f.vault.freeze(sig)).to.be.revertedWithCustomError(f.vault, "NotAllowed");
  });

  it("the same key cannot renew its own freeze; another key can", async () => {
    const f = await loadFixture(fx);
    await f.vault.freeze(await f.freezeSig(f.watcher));
    await expect(f.vault.renewFreeze(await f.renewSig(f.watcher))).to.be.revertedWithCustomError(f.vault, "SameFreezer");
    await time.increase(300);
    await expect(f.vault.renewFreeze(await f.renewSig(f.g1))).to.emit(f.vault, "FreezeRenewed");
    await time.increase(400);
    expect(await f.vault.isFrozen()).to.equal(true);
    const stale = await f.renewSig(f.watcher);
    await f.vault.renewFreeze(stale);
    await expect(f.vault.renewFreeze(stale)).to.be.revertedWithCustomError(f.vault, "NotAllowed");
  });

  it("strangers cannot freeze", async () => {
    const f = await loadFixture(fx);
    await expect(f.vault.connect(f.stranger).freeze("0x")).to.be.revertedWithCustomError(f.vault, "NotAllowed");
  });
});

describe("HisnVault: agent", () => {
  it("pays a saved payee inside the allowance", async () => {
    const f = await loadFixture(fx);
    await expect(f.vault.agentPay(...(await f.signAgentPay(f.payee.address, f.usdcAddr, U(15))))).to.emit(f.vault, "AgentPaid");
    expect(await f.usdc.balanceOf(f.payee.address)).to.equal(U(15));
  });

  it("refuses a new recipient", async () => {
    const f = await loadFixture(fx);
    await expect(f.vault.agentPay(...(await f.signAgentPay(f.stranger.address, f.usdcAddr, U(5))))).to.be.revertedWithCustomError(
      f.vault,
      "NotPayee",
    );
  });

  it("refuses over the two-day allowance", async () => {
    const f = await loadFixture(fx);
    await f.vault.agentPay(...(await f.signAgentPay(f.payee.address, f.usdcAddr, U(15))));
    await expect(f.vault.agentPay(...(await f.signAgentPay(f.payee.address, f.usdcAddr, U(6))))).to.be.revertedWithCustomError(
      f.vault,
      "OverAgentLimit",
    );
  });

  it("refuses a puck-signed PAY used as AGENT_PAY", async () => {
    const f = await loadFixture(fx);
    await expect(f.vault.agentPay(...(await f.signAgentPay(f.payee.address, f.usdcAddr, U(5), f.puck)))).to.be.revertedWithCustomError(
      f.vault,
      "BadSignature",
    );
  });

  it("refuses a payee still on probation", async () => {
    const f = await deploy({ probation: 3600 });
    await expect(f.vault.agentPay(...(await f.signAgentPay(f.payee.address, f.usdcAddr, U(5))))).to.be.revertedWithCustomError(
      f.vault,
      "OnProbation",
    );
    expect(await f.vault.tierFor(f.payee.address, f.usdcAddr, U(5))).to.equal(1);
  });
});
