import { ethers, network } from "hardhat";
import { getBytes, Signer } from "ethers";
import {
  payDigest,
  agentPayDigest,
  vetoDigest,
  cancelDigest,
  approveDigest,
  freezeDigest,
  renewFreezeDigest,
  reconfirmDigest,
  changeDigest,
  changeApproveDigest,
  changeVetoDigest,
  encodeChangeData,
  ChangeFields,
  ChangeKind,
} from "@hisn/shared";

export const SCHEDULE_ADDR = "0x000000000000000000000000000000000000016b";
export const U = (n: number | string) => ethers.parseUnits(String(n), 6);
export const H = (n: number | string) => ethers.parseEther(String(n));

export const IM = {
  minCoolOff: 60,
  settingsDelay: 300,
  recoveryDelay: 600,
  approvalWindow: 1800,
  freezeMax: 600,
  probation: 0,
  gasReserve: H(10),
  execGas: 1_000_000,
};

export const USDC_LIMITS = { instantMax: U(50), waitMax: U(500), dailyCap: U(100), agentDailyMax: U(20) };
export const HBAR_LIMITS = { instantMax: H(50), waitMax: H(500), dailyCap: H(100), agentDailyMax: H(20) };

export interface DeployOpts {
  guardians?: number;
  probation?: number;
  extraPayees?: string[];
  usdcFunding?: bigint;
  /** Merkle root of the puck's hash-based keys; zero (default) keeps the classical-only mode. */
  pqRoot?: string;
  pqHeight?: number;
  hbarFunding?: bigint;
}

export async function deploy(opts: DeployOpts = {}) {
  const s = await ethers.getSigners();
  const [relayer, puck, g1, g2, watcher, agent, payee, stranger, g3, other] = s;
  const nG = opts.guardians ?? 2;
  const guardians = [g1, g2, g3].slice(0, nG);

  const mockArt = await ethers.getContractFactory("MockScheduleService");
  const tmp = await mockArt.deploy();
  await tmp.waitForDeployment();
  const code = await ethers.provider.getCode(await tmp.getAddress());
  await network.provider.send("hardhat_setCode", [SCHEDULE_ADDR, code]);
  const hss = await ethers.getContractAt("MockScheduleService", SCHEDULE_ADDR);

  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await usdc.waitForDeployment();

  const verifier = await (await ethers.getContractFactory("HisnPQVerifier")).deploy();
  await verifier.waitForDeployment();

  const Vault = await ethers.getContractFactory("HisnVault");
  const vault = await Vault.deploy(
    puck.address,
    guardians.map((g) => g.address),
    [watcher.address],
    agent.address,
    await usdc.getAddress(),
    60,
    { ...IM, probation: opts.probation ?? 0 },
    HBAR_LIMITS,
    USDC_LIMITS,
    [payee.address, ...(opts.extraPayees ?? [])],
    opts.pqRoot ?? ethers.ZeroHash,
    opts.pqHeight ?? 4,
    await verifier.getAddress(),
    { value: opts.hbarFunding ?? H(1000) },
  );
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  await vault.associateToken();
  await usdc.mint(vaultAddr, opts.usdcFunding ?? U(2000));

  const ctx = { chainId: 296n, vault: vaultAddr };
  const usdcAddr = await usdc.getAddress();

  const sign = async (signer: Signer, digest: string) => signer.signMessage(getBytes(digest));
  let nonceCounter = 1n;
  const now = async () => BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

  const signPay = async (to: string, token: string, amount: bigint, signer: Signer = puck, deadlineOffset = 120n) => {
    const nonce = nonceCounter++;
    const deadline = (await now()) + deadlineOffset;
    const sig = await sign(signer, payDigest(ctx, { to, token, amount, nonce, deadline }));
    return { to, token, amount, nonce, deadline, sig };
  };

  const propose = async (to: string, token: string, amount: bigint) => {
    const p = await signPay(to, token, amount);
    const tx = await vault.connect(relayer).propose(p.to, p.token, p.amount, p.nonce, p.deadline, p.sig);
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l) => {
        try {
          return vault.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "Proposed");
    return { id: ev!.args.id as bigint, tier: Number(ev!.args.tier), tx };
  };

  const reconfirmArgs = async (id: bigint, signer: Signer = puck) => {
    const nonce = nonceCounter++;
    const deadline = (await now()) + 120n;
    const sig = await sign(signer, reconfirmDigest(ctx, id, nonce, deadline));
    return [id, nonce, deadline, sig] as const;
  };

  const signAgentPay = async (to: string, token: string, amount: bigint, signer: Signer = agent) => {
    const nonce = nonceCounter++;
    const deadline = (await now()) + 120n;
    const sig = await sign(signer, agentPayDigest(ctx, { to, token, amount, nonce, deadline }));
    return [to, token, amount, nonce, deadline, sig] as const;
  };

  const vetoSig = (id: bigint, signer: Signer) => sign(signer, vetoDigest(ctx, id));
  const cancelSig = (id: bigint, signer: Signer = puck) => sign(signer, cancelDigest(ctx, id));
  const approveSig = (id: bigint, signer: Signer) => sign(signer, approveDigest(ctx, id));
  const freezeSig = async (signer: Signer) => sign(signer, freezeDigest(ctx, BigInt(await vault.epoch())));
  const renewSig = async (signer: Signer) =>
    sign(signer, renewFreezeDigest(ctx, BigInt(await vault.epoch()), BigInt(await vault.frozenUntil())));

  const changeArgs = async (c: ChangeFields, signer: Signer = puck) => {
    const nonce = nonceCounter++;
    const deadline = (await now()) + 120n;
    const keyEpoch = BigInt(await vault.keyEpoch());
    const sig = await sign(signer, changeDigest(ctx, c, keyEpoch, nonce, deadline));
    return [c.kind, encodeChangeData(c), nonce, deadline, sig] as const;
  };

  const proposeChange = async (c: ChangeFields, signer: Signer = puck) => {
    const args = await changeArgs(c, signer);
    await (await vault.connect(relayer).proposeChange(...args)).wait();
    return await vault.changeCount();
  };

  const changeApproveSig = async (id: bigint, signer: Signer) => {
    const c = await vault.getChange(id);
    return sign(signer, changeApproveDigest(ctx, id, Number(c.kind) as ChangeKind, c.data));
  };
  const changeVetoSig = (id: bigint, signer: Signer) => sign(signer, changeVetoDigest(ctx, id));

  const lastSchedule = async () => {
    const n = await hss.count();
    return n === 0n ? null : await hss.all(n - 1n);
  };

  return {
    vault,
    usdc,
    hss,
    ctx,
    usdcAddr,
    relayer,
    puck,
    g1,
    g2,
    g3,
    watcher,
    agent,
    payee,
    stranger,
    other,
    sign,
    signPay,
    propose,
    reconfirmArgs,
    signAgentPay,
    vetoSig,
    cancelSig,
    approveSig,
    freezeSig,
    renewSig,
    changeArgs,
    proposeChange,
    changeApproveSig,
    changeVetoSig,
    lastSchedule,
    now,
  };
}

export const HBAR = ethers.ZeroAddress;
export { ChangeKind };
