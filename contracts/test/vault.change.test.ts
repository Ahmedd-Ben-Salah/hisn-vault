import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deploy, U, ChangeKind } from "./fixture";

const fx = () => deploy();

describe("HisnVault: settings changes and recovery", () => {
  it("ADD_PAYEE needs a guardian yes and the settings delay", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.ADD_PAYEE, address: f.stranger.address });
    await expect(f.vault.executeChange(id)).to.be.revertedWithCustomError(f.vault, "NotConfirmed");
    await f.vault.approveChange(id, await f.changeApproveSig(id, f.g1));
    await expect(f.vault.executeChange(id)).to.be.revertedWithCustomError(f.vault, "NotReady");
    await time.increase(301);
    await expect(f.vault.executeChange(id)).to.emit(f.vault, "ChangeExecuted").withArgs(id, ChangeKind.ADD_PAYEE);
    expect(await f.vault.payeeSince(f.stranger.address)).to.not.equal(0n);
    expect(await f.vault.tierFor(f.stranger.address, f.usdcAddr, U(20))).to.equal(0);
  });

  it("only the puck proposes ordinary changes, and a watcher cannot approve", async () => {
    const f = await loadFixture(fx);
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.ADD_PAYEE, address: f.stranger.address }, f.g1))),
    ).to.be.revertedWithCustomError(f.vault, "NotPuck");
    const id = await f.proposeChange({ kind: ChangeKind.ADD_PAYEE, address: f.stranger.address });
    await expect(f.vault.approveChange(id, await f.changeApproveSig(id, f.watcher))).to.be.revertedWithCustomError(
      f.vault,
      "NotGuardian",
    );
  });

  it("a stranger can neither approve nor stop a live change", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.ADD_PAYEE, address: f.other.address });
    await expect(f.vault.approveChange(id, await f.changeApproveSig(id, f.stranger))).to.be.revertedWithCustomError(
      f.vault,
      "NotGuardian",
    );
    await expect(f.vault.vetoChange(id, await f.changeVetoSig(id, f.stranger))).to.be.revertedWithCustomError(f.vault, "NotAllowed");
    expect((await f.vault.getChange(id)).status).to.equal(1n);
  });

  it("a guardian or watcher can never be added as a payee", async () => {
    const f = await loadFixture(fx);
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.ADD_PAYEE, address: f.g1.address }))),
    ).to.be.revertedWithCustomError(f.vault, "KeyAlreadyUsed");
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.ADD_PAYEE, address: f.watcher.address }))),
    ).to.be.revertedWithCustomError(f.vault, "KeyAlreadyUsed");
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.ADD_GUARDIAN, address: f.payee.address }))),
    ).to.be.revertedWithCustomError(f.vault, "KeyAlreadyUsed");
  });

  it("any guardian, watcher or the puck can stop a change", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.SET_COOLOFF, seconds: 120n });
    await expect(f.vault.vetoChange(id, await f.changeVetoSig(id, f.watcher))).to.emit(f.vault, "ChangeVetoed");
    await expect(f.vault.approveChange(id, await f.changeApproveSig(id, f.g1))).to.be.revertedWithCustomError(
      f.vault,
      "NotPending",
    );
  });

  it("SET_COOLOFF cannot go below MIN_COOLOFF", async () => {
    const f = await loadFixture(fx);
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.SET_COOLOFF, seconds: 59n }))),
    ).to.be.revertedWithCustomError(f.vault, "BelowMinCoolOff");
    const id = await f.proposeChange({ kind: ChangeKind.SET_COOLOFF, seconds: 180n });
    await f.vault.connect(f.g1).approveChange(id, "0x");
    await time.increase(301);
    await f.vault.executeChange(id);
    expect(await f.vault.coolOff()).to.equal(180n);
  });

  it("SET_LIMITS applies the four numbers", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({
      kind: ChangeKind.SET_LIMITS,
      token: f.usdcAddr,
      instantMax: U(200),
      waitMax: U(1000),
      dailyCap: U(400),
      agentDailyMax: U(50),
    });
    await f.vault.connect(f.g2).approveChange(id, "0x");
    await time.increase(301);
    await f.vault.executeChange(id);
    const l = await f.vault.limits(f.usdcAddr);
    expect(l.instantMax).to.equal(U(200));
    expect(l.agentDailyMax).to.equal(U(50));
  });

  it("REMOVE_PAYEE applies at once", async () => {
    const f = await loadFixture(fx);
    await f.proposeChange({ kind: ChangeKind.REMOVE_PAYEE, address: f.payee.address });
    expect(await f.vault.payeeSince(f.payee.address)).to.equal(0n);
  });

  it("a waiting change dies after a freeze", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.ADD_PAYEE, address: f.stranger.address });
    await f.vault.connect(f.g1).approveChange(id, "0x");
    await f.vault.connect(f.watcher).freeze("0x");
    await time.increase(301);
    await expect(f.vault.executeChange(id)).to.be.revertedWithCustomError(f.vault, "ChangeDead");
  });

  it("UNFREEZE lifts a freeze after the settings delay", async () => {
    const f = await loadFixture(fx);
    await f.vault.connect(f.watcher).freeze("0x");
    const id = await f.proposeChange({ kind: ChangeKind.UNFREEZE });
    await f.vault.connect(f.g1).approveChange(id, "0x");
    await time.increase(301);
    await expect(f.vault.executeChange(id)).to.emit(f.vault, "Unfrozen");
    expect(await f.vault.isFrozen()).to.equal(false);
  });

  it("one guardian cannot recover the puck", async () => {
    const f = await deploy({ guardians: 1 });
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.RECOVER_PUCK, address: f.other.address }, f.g1))),
    ).to.be.revertedWithCustomError(f.vault, "LastGuardian");
  });

  it("two different guardians recover the puck after RECOVERY_DELAY", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.RECOVER_PUCK, address: f.other.address }, f.g1);
    await expect(f.vault.connect(f.g1).approveChange(id, "0x")).to.be.revertedWithCustomError(f.vault, "SameApprover");
    await f.vault.connect(f.g2).approveChange(id, "0x");
    await time.increase(301);
    await expect(f.vault.executeChange(id)).to.be.revertedWithCustomError(f.vault, "NotReady");
    await time.increase(300);
    await f.vault.executeChange(id);
    expect(await f.vault.puck()).to.equal(f.other.address);
    const p = await f.signPay(f.payee.address, f.usdcAddr, U(5));
    await expect(f.vault.propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig)).to.be.revertedWithCustomError(
      f.vault,
      "BadSignature",
    );
  });

  it("the old puck cancels a recovery", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.RECOVER_PUCK, address: f.other.address }, f.g1);
    await f.vault.connect(f.g2).approveChange(id, "0x");
    await f.vault.vetoChange(id, await f.changeVetoSig(id, f.puck));
    await time.increase(601);
    await expect(f.vault.executeChange(id)).to.be.revertedWithCustomError(f.vault, "NotPending");
  });

  it("REMOVE_GUARDIAN: fast with another guardian, the target cannot approve", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.REMOVE_GUARDIAN, address: f.g2.address });
    await expect(f.vault.connect(f.g2).approveChange(id, "0x")).to.be.revertedWithCustomError(f.vault, "SameApprover");
    await f.vault.connect(f.g1).approveChange(id, "0x");
    await time.increase(301);
    await f.vault.executeChange(id);
    expect(await f.vault.getGuardians()).to.deep.equal([f.g1.address]);
    expect(await f.vault.roleOf(f.g2.address)).to.equal(0n);
  });

  it("REMOVE_GUARDIAN: alone takes 2 x RECOVERY_DELAY and the target cannot block it", async () => {
    const f = await loadFixture(fx);
    const id = await f.proposeChange({ kind: ChangeKind.REMOVE_GUARDIAN, address: f.g2.address });
    await expect(f.vault.connect(f.g2).vetoChange(id, "0x")).to.be.revertedWithCustomError(f.vault, "NotAllowed");
    await expect(f.vault.connect(f.watcher).vetoChange(id, "0x")).to.be.revertedWithCustomError(f.vault, "NotAllowed");
    await time.increase(301);
    await expect(f.vault.executeChange(id)).to.be.revertedWithCustomError(f.vault, "NotReady");
    await time.increase(900);
    await f.vault.executeChange(id);
    expect((await f.vault.getGuardians()).length).to.equal(1);
  });

  it("the last guardian cannot be removed", async () => {
    const f = await deploy({ guardians: 1 });
    await expect(
      f.vault.proposeChange(...(await f.changeArgs({ kind: ChangeKind.REMOVE_GUARDIAN, address: f.g1.address }))),
    ).to.be.revertedWithCustomError(f.vault, "LastGuardian");
  });

  it("ADD_WATCHER and SET_AGENT bump keyEpoch", async () => {
    const f = await loadFixture(fx);
    const before = await f.vault.keyEpoch();
    const id = await f.proposeChange({ kind: ChangeKind.ADD_WATCHER, address: f.other.address });
    await f.vault.connect(f.g1).approveChange(id, "0x");
    await time.increase(301);
    await f.vault.executeChange(id);
    expect(await f.vault.keyEpoch()).to.equal(before + 1n);
    expect(await f.vault.getWatchers()).to.include(f.other.address);
    const id2 = await f.proposeChange({ kind: ChangeKind.SET_AGENT, address: ethers.ZeroAddress });
    await f.vault.connect(f.g1).approveChange(id2, "0x");
    await time.increase(301);
    await f.vault.executeChange(id2);
    expect(await f.vault.agent()).to.equal(ethers.ZeroAddress);
  });

  it("a change signature is bound to keyEpoch", async () => {
    const f = await loadFixture(fx);
    const args = await f.changeArgs({ kind: ChangeKind.ADD_PAYEE, address: f.stranger.address });
    await f.vault.connect(f.g1).freeze("0x");
    await expect(f.vault.proposeChange(...args)).to.be.revertedWithCustomError(f.vault, "NotPuck");
  });
});
