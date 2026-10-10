import { Wallet, getBytes, ZeroAddress } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { payDigest, hashscanContract } from "@hisn/shared";
import { provider, relayer, at, need, ROOT, MIRROR_URL } from "./lib/env";
import { simKeys, nonce, chainNow, signVeto, signApprove, signCancel, signFreeze, signReconfirm } from "./lib/actors";

const STATUS = ["NONE", "PENDING", "EXECUTED", "VETOED", "CANCELLED", "EXPIRED"];
const lines: string[] = [];
let failed = 0;

function varint(n: number): string {
  let out = "";
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out += b.toString(16).padStart(2, "0");
  } while (n);
  return out;
}

function record(ok: boolean, what: string, detail: string) {
  if (!ok) failed++;
  lines.push(`| ${ok ? "PASS" : "FAIL"} | ${what} | ${detail} |`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${detail}`);
}

async function main() {
  const p = provider();
  const r = relayer(p);
  const vault = at("HisnVault", need("VAULT_ADDRESS"), r);
  const vaultAddr = await vault.getAddress();
  const ctx = { chainId: 296n, vault: vaultAddr };
  const { puck } = simKeys();
  const stranger = new Wallet(Wallet.createRandom().privateKey);
  const payee = (await vault.getPayees())[0] ?? r.address;

  async function reverts(what: string, call: () => Promise<unknown>, expected: string[]) {
    try {
      await call();
      record(false, what, "call succeeded");
    } catch (e: any) {
      const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
      let name = "";
      try {
        name = vault.interface.parseError(data)?.name ?? "";
      } catch {
        name = "";
      }
      record(expected.includes(name), what, `reverted with ${name || e?.shortMessage || "unknown"}`);
    }
  }

  if (await vault.isFrozen()) throw new Error("vault is frozen; run again after the freeze ends");

  const now = await chainNow(vault);
  const deadline = now + 120n;
  const n = nonce();
  const bad = await stranger.signMessage(getBytes(payDigest(ctx, { to: payee, token: ZeroAddress, amount: 1n, nonce: n, deadline })));
  const anyId = await vault.paymentCount();

  lines.push("## Check 2: every signed function refuses a stranger's key", "", "| Result | Call | Detail |", "|---|---|---|");
  await reverts("propose", () => vault.propose.staticCall(payee, ZeroAddress, 1n, n, deadline, bad), ["BadSignature"]);
  await reverts("agentPay", () => vault.agentPay.staticCall(payee, ZeroAddress, 1n, n, deadline, bad), ["BadSignature"]);
  await reverts("reconfirm", () => vault.reconfirm.staticCall(anyId, n, deadline, bad), ["BadSignature"]);
  await reverts("approve", async () => vault.approve.staticCall(anyId, await signApprove(ctx, stranger, anyId)), ["NotGuardian"]);
  await reverts("veto", async () => vault.veto.staticCall(anyId, await signVeto(ctx, stranger, anyId)), ["NotGuardian"]);
  await reverts("cancel", async () => vault.cancel.staticCall(anyId, await signCancel(ctx, stranger, anyId)), ["BadSignature"]);
  const ep = await vault.epoch();
  await reverts("freeze", async () => vault.freeze.staticCall(await signFreeze(ctx, stranger, ep)), ["NotAllowed"]);
  const changeData = "0x" + stranger.address.slice(2).toLowerCase().padStart(64, "0");
  await reverts("proposeChange", () => vault.proposeChange.staticCall(0, changeData, n, deadline, bad), ["NotPuck"]);

  lines.push("", "## Check 3: no person holds an admin key", "", "| Result | Call | Detail |", "|---|---|---|");
  const info = await (await fetch(`${MIRROR_URL}/api/v1/contracts/${vaultAddr}`)).json();
  const admin = info.admin_key;
  const inner = "18" + varint(Number(String(info.contract_id).split(".")[2]));
  const selfKey = "0a" + (inner.length / 2).toString(16).padStart(2, "0") + inner;
  const adminOk = admin?._type === "ProtobufEncoded" && admin.key === selfKey;
  record(adminOk, "contract admin key on the mirror node", `the admin key is the contract itself, \`${JSON.stringify(admin)}\` (contract ${info.contract_id}, ${hashscanContract(vaultAddr)})`);

  lines.push("", "## Check 4: one changed byte breaks the puck's signature", "", "| Result | Call | Detail |", "|---|---|---|");
  const good = await puck.signMessage(getBytes(payDigest(ctx, { to: payee, token: ZeroAddress, amount: 100n, nonce: n, deadline })));
  await reverts("propose with amount 100 signed, 101 sent", () => vault.propose.staticCall(payee, ZeroAddress, 101n, n, deadline, good), ["BadSignature"]);
  const flipped = good.slice(0, 10) + ((parseInt(good.slice(10, 12), 16) ^ 1).toString(16).padStart(2, "0")) + good.slice(12);
  await reverts("propose with one signature byte flipped", () => vault.propose.staticCall(payee, ZeroAddress, 100n, n, deadline, flipped), ["BadSignature"]);

  lines.push("", "## Checks 5 and 6: closed payments stay closed", "", "| Result | Call | Detail |", "|---|---|---|");
  let vetoed = 0n;
  let closedByFreeze = 0n;
  for (let id = anyId; id >= 1n && (!vetoed || !closedByFreeze); id--) {
    const s = STATUS[Number((await vault.getPayment(id)).status)];
    if (s === "VETOED" && !vetoed) vetoed = id;
    if ((s === "CANCELLED" || s === "EXPIRED") && !closedByFreeze) closedByFreeze = id;
  }
  if (vetoed) await reverts(`execute vetoed payment ${vetoed}`, () => vault.execute.staticCall(vetoed), ["NotPending"]);
  else record(false, "execute a vetoed payment", "no vetoed payment on this vault; run the end-to-end story first");
  if (closedByFreeze) {
    await reverts(`execute payment ${closedByFreeze} closed by the freeze, after the unfreeze`, () => vault.execute.staticCall(closedByFreeze), ["NotPending"]);
    const rc = await signReconfirm(ctx, puck, closedByFreeze, now);
    await reverts(`reconfirm payment ${closedByFreeze} after the unfreeze`, () => vault.reconfirm.staticCall(...rc), ["NotPending"]);
  } else record(false, "execute a payment closed by a freeze", "none on this vault; run the end-to-end story first");

  const head = [
    "# Security checks on the testnet vault",
    "",
    `Vault \`${info.contract_id}\` (\`${vaultAddr}\`), run ${new Date().toISOString()}. Calls are read-only simulations against Hashio, so they cost nothing and change nothing.`,
    "",
    "Check 1 (contract test suite with the malicious receiver) runs with `npm -w contracts test`; it also covers a stranger approving or stopping a live settings change, which needs a waiting change to test. Check 4 also has the on-chain Day-1 test 5 in `DAY1_RESULTS.md`.",
    "",
  ];
  writeFileSync(resolve(ROOT, "docs", "SECURITY_CHECKS.md"), [...head, ...lines, ""].join("\n"));
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
