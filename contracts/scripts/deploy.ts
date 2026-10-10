import { Wallet, getAddress } from "ethers";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { USDC_TESTNET, hashscanContract, hashscanTopic, TINYBAR_TO_WEIBAR, PqKeyTree, pqSeedFromKey, PQ_DEFAULT_HEIGHT } from "@hisn/shared";
import { provider, relayer, deployContract, opt, setEnv, txLink, ROOT, mirrorRetry, sleep } from "./lib/env";
import { createTopic } from "./lib/hcs";

const TINY = 100_000_000n;
const USDC_UNIT = 1_000_000n;

function list(name: string): string[] {
  return opt(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => getAddress(s));
}

function ensureKey(addrVar: string, keyVar: string): string {
  const addr = opt(addrVar);
  if (addr) return getAddress(addr);
  let pk = opt(keyVar);
  if (!pk) {
    pk = Wallet.createRandom().privateKey;
    setEnv({ [keyVar]: pk });
  }
  const a = new Wallet(pk).address;
  setEnv({ [addrVar]: a });
  return a;
}

async function main() {
  const p = provider();
  const r = relayer(p);
  console.log(`relayer ${r.address}, balance ${(await p.getBalance(r.address)) / TINYBAR_TO_WEIBAR} tinybar`);

  const puck = ensureKey("PUCK_ADDRESS", "SIM_PUCK_PRIVATE_KEY");
  let guardians = list("GUARDIAN_ADDRESSES");
  if (guardians.length === 0) {
    const keys = [Wallet.createRandom().privateKey, Wallet.createRandom().privateKey];
    setEnv({ SIM_GUARDIAN_PRIVATE_KEYS: keys.join(",") });
    guardians = keys.map((k) => new Wallet(k).address);
    setEnv({ GUARDIAN_ADDRESSES: guardians.join(",") });
  }
  let watchers = list("WATCHER_ADDRESSES");
  if (watchers.length === 0) {
    watchers = [ensureKey("SIM_WATCHER_ADDRESS", "SIM_WATCHER_PRIVATE_KEY")];
    setEnv({ WATCHER_ADDRESSES: watchers.join(",") });
  }
  let agentKey = opt("AGENT_PRIVATE_KEY");
  if (!agentKey) {
    agentKey = Wallet.createRandom().privateKey;
    setEnv({ AGENT_PRIVATE_KEY: agentKey });
  }
  const agent = new Wallet(agentKey).address;
  const payees = list("PAYEE_ADDRESSES");

  const coolOff = Number(opt("COOLOFF_SECONDS", "60"));
  const im = {
    minCoolOff: Number(opt("MIN_COOLOFF", "60")),
    settingsDelay: Number(opt("SETTINGS_DELAY", "300")),
    recoveryDelay: Number(opt("RECOVERY_DELAY", "600")),
    approvalWindow: Number(opt("APPROVAL_WINDOW", "1800")),
    freezeMax: Number(opt("FREEZE_MAX", "600")),
    probation: Number(opt("PROBATION", "0")),
    gasReserve: BigInt(opt("GAS_RESERVE_HBAR", "10")) * TINY,
    execGas: BigInt(opt("EXEC_GAS", "1000000")),
  };
  const hbarLimits = { instantMax: 50n * TINY, waitMax: 500n * TINY, dailyCap: 100n * TINY, agentDailyMax: 20n * TINY };
  const usdcLimits = { instantMax: 50n * USDC_UNIT, waitMax: 500n * USDC_UNIT, dailyCap: 100n * USDC_UNIT, agentDailyMax: 20n * USDC_UNIT };
  const fund = BigInt(opt("VAULT_FUND_HBAR", "40")) * TINY;
  const usdc = opt("USDC_ADDRESS", USDC_TESTNET);

  // Post-quantum layer: the puck's hash-based key root. A real puck prints it with the console command `pq`.
  // Without PQ_ROOT, the simulated puck's root is derived from SIM_PUCK_PRIVATE_KEY. PQ=0 deploys classical-only.
  const pqHeight = Number(opt("PQ_HEIGHT", String(PQ_DEFAULT_HEIGHT)));
  let pqRoot = "0x" + "00".repeat(32);
  if (opt("PQ", "1") !== "0") {
    if (opt("PQ_ROOT")) pqRoot = opt("PQ_ROOT");
    else if (opt("SIM_PUCK_PRIVATE_KEY")) pqRoot = new PqKeyTree(pqSeedFromKey(opt("SIM_PUCK_PRIVATE_KEY")), pqHeight).root;
    else throw new Error("Set PQ_ROOT (puck console: pq) or PQ=0 for a classical-only vault");
  }
  const verifier = await deployContract("HisnPQVerifier", r, [], 0n);
  const verifierAddr = await verifier.getAddress();
  console.log(`pq verifier ${verifierAddr}, root ${pqRoot}, height ${pqHeight}`);

  const vault = await deployContract(
    "HisnVault",
    r,
    [puck, guardians, watchers, agent, getAddress(usdc.toLowerCase()), coolOff, im, hbarLimits, usdcLimits, payees, pqRoot, pqHeight, verifierAddr],
    fund,
  );
  const vaultAddr = await vault.getAddress();
  console.log(`vault ${vaultAddr}`);
  const deployTx = vault.deploymentTransaction();
  const assoc = await (await vault.associateToken({ gasLimit: 1_000_000 })).wait();
  await sleep(3000);
  const info = await mirrorRetry<any>(`/api/v1/contracts/${vaultAddr}`);

  const topicId = opt("REUSE_TOPIC") === "1" && opt("HCS_TOPIC_ID") ? opt("HCS_TOPIC_ID") : await createTopic(`HISN:${vaultAddr}`);

  const guardianFund = BigInt(opt("GUARDIAN_FUND_HBAR", "3"));
  if (guardianFund > 0n) {
    for (const g of [...guardians, ...watchers]) {
      const t = await r.sendTransaction({ to: g, value: guardianFund * TINY * TINYBAR_TO_WEIBAR, gasLimit: 1_000_000 });
      await t.wait();
    }
  }

  setEnv({ VAULT_ADDRESS: vaultAddr, VAULT_ID: info.contract_id, HCS_TOPIC_ID: topicId });
  const out = {
    network: "testnet",
    vault: vaultAddr,
    vaultId: info.contract_id,
    topicId,
    puck,
    guardians,
    watchers,
    agent,
    payees,
    coolOff,
    immutables: { ...im, gasReserve: im.gasReserve.toString(), execGas: im.execGas.toString() },
    deployTx: deployTx?.hash,
    associateTx: assoc?.hash,
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
  writeFileSync(resolve(ROOT, "deployments", "testnet.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(hashscanContract(vaultAddr));
  console.log(hashscanTopic(topicId));
  if (deployTx) console.log(txLink(deployTx.hash));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
