import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, ContractFactory, HDNodeWallet, JsonRpcProvider, Mnemonic, NonceManager, Wallet, getAddress, type InterfaceAbi } from "ethers";
import { USDC_TESTNET, SCHEDULE_SERVICE, PqKeyTree, pqSeedFromKey, PQ_DEFAULT_HEIGHT } from "../src/shared.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACTS = resolve(ROOT, "contracts");
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
const PORT = new URL(RPC).port || "8545";
const MNEMONIC = "test test test test test test test test test test test junk";
const TOKEN = process.env.RELAYER_API_TOKEN ?? "local-dev";
const COOLOFF = Number(process.env.COOLOFF_SECONDS ?? 60);

const T8 = 100_000_000n;
const U6 = 1_000_000n;

function key(i: number): string {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(MNEMONIC), `m/44'/60'/0'/0/${i}`).privateKey;
}

function artifact(name: string, file = `${name}.sol`): { abi: InterfaceAbi; bytecode: string } {
  const p = resolve(CONTRACTS, "artifacts", "contracts", file, `${name}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p}; run npm -w contracts run build`);
  const a = JSON.parse(readFileSync(p, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode };
}

async function waitRpc(p: JsonRpcProvider): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await p.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`no chain at ${RPC}`);
}

async function rpcUp(p: JsonRpcProvider): Promise<boolean> {
  try {
    await p.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const provider = new JsonRpcProvider(RPC, 296, { staticNetwork: true, polling: true, pollingInterval: 500 });
  let node: ChildProcess | null = null;
  if (!(await rpcUp(provider))) {
    console.log("starting local chain (hardhat node, chain id 296)...");
    node = spawn("npx", ["hardhat", "node", "--port", PORT], { cwd: CONTRACTS, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
    node.on("exit", (c) => {
      console.error(`local chain exited (${c})`);
      process.exit(1);
    });
    await waitRpc(provider);
  }
  const net = await provider.getNetwork();
  if (net.chainId !== 296n) throw new Error(`chain id is ${net.chainId}, need 296`);

  const k = {
    relayer: key(0),
    puck: key(1),
    guardian1: key(2),
    guardian2: key(3),
    watcher: key(4),
    agent: key(5),
    payeeSami: key(6),
    payeeBills: key(7),
    stranger: key(8),
    network: key(9),
  };
  const deployer = new NonceManager(new Wallet(k.relayer, provider));
  const addr = (pk: string) => new Wallet(pk).address;

  const hssArt = artifact("MockScheduleService", "mocks/MockScheduleService.sol");
  const tmp = await new ContractFactory(hssArt.abi, hssArt.bytecode, deployer).deploy();
  await tmp.waitForDeployment();
  await provider.send("hardhat_setCode", [SCHEDULE_SERVICE, await provider.getCode(await tmp.getAddress())]);

  const usdcArt = artifact("MockUSDC", "mocks/MockUSDC.sol");
  const tmpUsdc = await new ContractFactory(usdcArt.abi, usdcArt.bytecode, deployer).deploy();
  await tmpUsdc.waitForDeployment();
  await provider.send("hardhat_setCode", [USDC_TESTNET, await provider.getCode(await tmpUsdc.getAddress())]);
  const usdc = new Contract(USDC_TESTNET, usdcArt.abi, deployer);

  const pageGuardian = process.env.GUARDIAN_PAGE_ADDRESS ? getAddress(process.env.GUARDIAN_PAGE_ADDRESS) : null;
  const guardians = [addr(k.guardian1), pageGuardian ?? addr(k.guardian2)];
  const payees = [addr(k.payeeSami), addr(k.payeeBills)];

  // Post-quantum layer: the simulated puck's hash-based keys (same derivation as the firmware). PQ=0 skips it.
  const pqHeight = Number(process.env.PQ_HEIGHT ?? PQ_DEFAULT_HEIGHT);
  const pqRoot = process.env.PQ === "0" ? "0x" + "00".repeat(32) : new PqKeyTree(pqSeedFromKey(k.puck), pqHeight).root;
  const verArt = artifact("HisnPQVerifier");
  const verifier = await new ContractFactory(verArt.abi, verArt.bytecode, deployer).deploy();
  await verifier.waitForDeployment();

  const vaultArt = artifact("HisnVault");
  const vaultF = new ContractFactory(vaultArt.abi, vaultArt.bytecode, deployer);
  const vault = await vaultF.deploy(
    addr(k.puck),
    guardians,
    [addr(k.watcher)],
    addr(k.agent),
    USDC_TESTNET,
    COOLOFF,
    {
      minCoolOff: 60,
      settingsDelay: Number(process.env.SETTINGS_DELAY ?? 120),
      recoveryDelay: Number(process.env.RECOVERY_DELAY ?? 300),
      approvalWindow: Number(process.env.APPROVAL_WINDOW ?? 900),
      freezeMax: Number(process.env.FREEZE_MAX ?? 300),
      probation: 0,
      gasReserve: 10n * T8,
      execGas: 1_000_000,
    },
    { instantMax: 50n * T8, waitMax: 500n * T8, dailyCap: 100n * T8, agentDailyMax: 20n * T8 },
    { instantMax: 50n * U6, waitMax: 500n * U6, dailyCap: 100n * U6, agentDailyMax: 20n * U6 },
    payees,
    pqRoot,
    pqHeight,
    await verifier.getAddress(),
    { value: 1000n * T8 },
  );
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  await (await (vault as Contract).associateToken()).wait();
  await (await usdc.mint(vaultAddr, 2000n * U6)).wait();
  if (pageGuardian) await (await deployer.sendTransaction({ to: pageGuardian, value: 10n ** 18n })).wait();

  const labels = [`${payees[0]}=Sami (son)`, `${payees[1]}=STEG electricity`].join(",");
  const env: Record<string, string> = {
    MODE: "local",
    RPC_URL: RPC,
    CHAIN_ID: "296",
    VAULT_ADDRESS: vaultAddr,
    USDC_ADDRESS: USDC_TESTNET,
    RELAYER_PRIVATE_KEY: k.relayer,
    RELAYER_API_TOKEN: TOKEN,
    RELAYER_PORT: process.env.RELAYER_PORT ?? "8787",
    RELAYER_DB: "backend/hisn-local.db",
    PUCK_ADDRESS: addr(k.puck),
    GUARDIAN_ADDRESSES: guardians.join(","),
    WATCHER_ADDRESSES: addr(k.watcher),
    SIM_PUCK_PRIVATE_KEY: k.puck,
    SIM_GUARDIAN_PRIVATE_KEYS: [k.guardian1, k.guardian2].join(","),
    SIM_WATCHER_PRIVATE_KEY: k.watcher,
    AGENT_PRIVATE_KEY: k.agent,
    PAYEE_ADDRESSES: payees.join(","),
    PAYEE_LABELS: labels,
    STRANGER_ADDRESS: addr(k.stranger),
    LLM_API_KEY: process.env.LLM_API_KEY ?? "",
    LLM_MODEL: process.env.LLM_MODEL ?? "",
  };
  writeFileSync(resolve(ROOT, ".env.local"), Object.entries(env).map(([a, b]) => `${a}=${b}`).join("\n") + "\n");
  rmSync(resolve(ROOT, "backend/hisn-local.db"), { force: true });

  console.log("");
  console.log(`vault      ${vaultAddr}  (1000 HBAR, 2000 USDC, cool-off ${COOLOFF}s)`);
  console.log(`puck       ${addr(k.puck)}`);
  console.log(`guardians  ${guardians.join(", ")}${pageGuardian ? "  (second one is your phone page)" : ""}`);
  console.log(`watcher    ${addr(k.watcher)}  (guardian light)`);
  console.log(`agent      ${addr(k.agent)}`);
  console.log(`payees     Sami ${payees[0]}, STEG ${payees[1]}`);
  console.log(`stranger   ${addr(k.stranger)}  (use as the scammer's address)`);
  console.log("");
  console.log("wrote .env.local. Next, in other terminals:");
  console.log("  npm run relayer:local");
  console.log("  npm run sim:local");
  console.log(`  dashboard: VITE_RELAYER_URL=http://localhost:${env.RELAYER_PORT} VITE_RELAYER_TOKEN=${TOKEN}`);
  console.log("");
  console.log("this process now plays the Hedera schedule service: it fires each scheduled release at its second.");

  const timer = new NonceManager(new Wallet(k.network, provider));
  const hss = new Contract(SCHEDULE_SERVICE, hssArt.abi, timer);
  let busy = false;
  const fired = new Set<string>();
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await provider.send("evm_mine", []);
      const n = Number(await hss.count());
      const head = await provider.getBlock("latest");
      const nowS = Math.max(Math.floor(Date.now() / 1000), head?.timestamp ?? 0);
      for (let i = 0; i < n; i++) {
        const s: string = await hss.all(i);
        if (fired.has(s)) continue;
        const x = await hss.scheds(s);
        if (x.deleted || x.fired) {
          fired.add(s);
          if (x.deleted) console.log(`schedule ${s} deleted by the vault (payment stopped)`);
          continue;
        }
        if (nowS < Number(x.when)) continue;
        try {
          const tx = await hss.fire(s, { gasLimit: 2_000_000 });
          await tx.wait();
          fired.add(s);
          console.log(`network released schedule ${s} at ${new Date().toISOString()}`);
        } catch (e) {
          timer.reset();
          console.error(`fire ${s} failed: ${(e as Error).message.slice(0, 120)}`);
        }
      }
    } catch (e) {
      console.error("timer:", (e as Error).message.slice(0, 160));
    } finally {
      busy = false;
    }
  }, 1000);

  const stop = () => {
    node?.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
