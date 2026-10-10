import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet, getBytes, SigningKey, keccak256 } from "ethers";
import {
  TAG,
  Action,
  payDigest,
  agentPayDigest,
  vetoDigest,
  cancelDigest,
  approveDigest,
  freezeDigest,
  alertAckDigest,
  reconfirmDigest,
  renewFreezeDigest,
  changeDigest,
  changeApproveDigest,
  changeVetoDigest,
  encodeChangeData,
  ChangeKind,
  ethSignedHash,
  encodeDigestInput,
} from "../src/digest";
import { HBAR, USDC_TESTNET } from "../src/units";

const ctx = { chainId: 296n, vault: "0x00000000000000000000000000000000004E5a1d" };

const keys = {
  puck: "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318",
  guardian: "0x8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b41de8f",
  watcher: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  agent: "0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4",
};

const recipient = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

function sign(pk: string, digest: string) {
  const sk = new SigningKey(pk);
  const sig = sk.sign(ethSignedHash(digest));
  return { r: sig.r, s: sig.s, v: sig.v, serialized: sig.serialized };
}

const pay = { to: recipient, token: USDC_TESTNET, amount: 100_000_000n, nonce: 0x1122334455667788n, deadline: 1791644520n };
const payHbar = { to: recipient, token: HBAR, amount: 2_000_000_000n, nonce: 0xdeadbeefn, deadline: 1791644600n };

type Case = { name: string; action: Action; signer: keyof typeof keys; fields: Record<string, string>; encoded: string; digest: string };
const cases: Case[] = [];

function add(name: string, action: Action, signer: keyof typeof keys, fields: Record<string, string>, types: string[], values: unknown[], digest: string) {
  cases.push({ name, action, signer, fields, encoded: encodeDigestInput(ctx, action, types, values), digest });
}

const payTypes = ["address", "address", "uint256", "uint256", "uint256"];
const payFields = (p: typeof pay) => ({ to: p.to, token: p.token, amount: p.amount.toString(), nonce: p.nonce.toString(), deadline: p.deadline.toString() });

add("pay_usdc_100", Action.PAY, "puck", payFields(pay), payTypes, [pay.to, pay.token, pay.amount, pay.nonce, pay.deadline], payDigest(ctx, pay));
add("pay_hbar_20", Action.PAY, "puck", payFields(payHbar), payTypes, [payHbar.to, payHbar.token, payHbar.amount, payHbar.nonce, payHbar.deadline], payDigest(ctx, payHbar));
add("agent_pay_usdc_15", Action.AGENT_PAY, "agent", payFields({ ...pay, amount: 15_000_000n }), payTypes, [pay.to, pay.token, 15_000_000n, pay.nonce, pay.deadline], agentPayDigest(ctx, { ...pay, amount: 15_000_000n }));
add("veto_12", Action.VETO, "watcher", { paymentId: "12" }, ["uint256"], [12n], vetoDigest(ctx, 12n));
add("cancel_12", Action.CANCEL, "puck", { paymentId: "12" }, ["uint256"], [12n], cancelDigest(ctx, 12n));
add("approve_13", Action.APPROVE, "guardian", { paymentId: "13" }, ["uint256"], [13n], approveDigest(ctx, 13n));
add("freeze_0", Action.FREEZE, "guardian", { epoch: "0" }, ["uint256"], [0n], freezeDigest(ctx, 0n));
add("alert_ack_12", Action.ALERT_ACK, "watcher", { paymentId: "12", nonce: "7" }, ["uint256", "uint256"], [12n, 7n], alertAckDigest(ctx, 12n, 7n));
add("reconfirm_12", Action.RECONFIRM, "puck", { paymentId: "12", nonce: "99", deadline: "1791644700" }, ["uint256", "uint256", "uint256"], [12n, 99n, 1791644700n], reconfirmDigest(ctx, 12n, 99n, 1791644700n));

add("renew_freeze_1", Action.RENEW_FREEZE, "guardian", { epoch: "1", frozenUntil: "1791645000" }, ["uint256", "uint256"], [1n, 1791645000n], renewFreezeDigest(ctx, 1n, 1791645000n));

const addPayee = { kind: ChangeKind.ADD_PAYEE as const, address: recipient };
add(
  "change_add_payee",
  Action.CHANGE,
  "puck",
  { kind: "0", keyEpoch: "0", address: recipient, nonce: "5", deadline: "1791644520" },
  ["uint256", "uint256", "address", "uint256", "uint256"],
  [0n, 0n, recipient, 5n, 1791644520n],
  changeDigest(ctx, addPayee, 0n, 5n, 1791644520n),
);
const limitsChange = {
  kind: ChangeKind.SET_LIMITS as const,
  token: USDC_TESTNET,
  instantMax: 200_000_000n,
  waitMax: 1_000_000_000n,
  dailyCap: 400_000_000n,
  agentDailyMax: 50_000_000n,
};
add(
  "change_set_limits",
  Action.CHANGE,
  "puck",
  { kind: "2", keyEpoch: "3", token: USDC_TESTNET, instantMax: "200000000", waitMax: "1000000000", dailyCap: "400000000", agentDailyMax: "50000000", nonce: "6", deadline: "1791644520" },
  ["uint256", "uint256", "address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
  [2n, 3n, USDC_TESTNET, 200_000_000n, 1_000_000_000n, 400_000_000n, 50_000_000n, 6n, 1791644520n],
  changeDigest(ctx, limitsChange, 3n, 6n, 1791644520n),
);
add(
  "change_unfreeze",
  Action.CHANGE,
  "puck",
  { kind: "9", keyEpoch: "2", nonce: "7", deadline: "1791644520" },
  ["uint256", "uint256", "uint256", "uint256"],
  [9n, 2n, 7n, 1791644520n],
  changeDigest(ctx, { kind: ChangeKind.UNFREEZE }, 2n, 7n, 1791644520n),
);
const addPayeeData = encodeChangeData(addPayee);
add(
  "change_approve_4",
  Action.CHANGE_APPROVE,
  "guardian",
  { changeId: "4", kind: "0", dataHash: keccak256(addPayeeData) },
  ["uint256", "uint256", "bytes32"],
  [4n, 0n, keccak256(addPayeeData)],
  changeApproveDigest(ctx, 4n, ChangeKind.ADD_PAYEE, addPayeeData),
);
add("change_veto_4", Action.CHANGE_VETO, "watcher", { changeId: "4" }, ["uint256"], [4n], changeVetoDigest(ctx, 4n));

const out = {
  version: 1,
  tag: TAG,
  chainId: Number(ctx.chainId),
  vault: ctx.vault,
  keys: Object.fromEntries(Object.entries(keys).map(([k, pk]) => [k, { privateKey: pk, address: new Wallet(pk).address }])),
  cases: cases.map((c) => ({
    ...c,
    wordCount: getBytes(c.encoded).length / 32,
    ethSignedHash: ethSignedHash(c.digest),
    signature: sign(keys[c.signer], c.digest),
  })),
};

const path = resolve(__dirname, "..", "test-vectors.json");
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.cases.length} cases to ${path}`);
