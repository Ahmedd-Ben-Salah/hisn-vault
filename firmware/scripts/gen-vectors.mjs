import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const v = JSON.parse(readFileSync(resolve(here, "../../shared/test-vectors.json"), "utf8"));
const order = ["to", "token", "amount", "nonce", "deadline", "paymentId", "epoch", "frozenUntil", "kind", "keyEpoch", "address", "instantMax", "waitMax", "dailyCap", "agentDailyMax", "changeId", "dataHash"];
const q = (s) => JSON.stringify(String(s ?? ""));
const rows = v.cases.map((c) => {
  const f = order.map((k) => q(c.fields[k])).join(", ");
  return `  {${q(c.name)}, ${c.action}, ${q(v.keys[c.signer].privateKey)}, ${q(v.keys[c.signer].address)}, {${f}}, ${q(c.digest)}, ${q(c.ethSignedHash)}, ${q(c.signature.r)}, ${q(c.signature.s)}},`;
});
const out = `#pragma once
#define V_CHAIN_ID ${v.chainId}ULL
#define V_VAULT ${q(v.vault)}
enum { F_TO, F_TOKEN, F_AMOUNT, F_NONCE, F_DEADLINE, F_PAYMENT_ID, F_EPOCH, F_FROZEN_UNTIL, F_KIND, F_KEY_EPOCH, F_ADDRESS, F_INSTANT, F_WAIT, F_DAILY, F_AGENT, F_CHANGE_ID, F_DATA_HASH, F_COUNT };
typedef struct {
  const char *name;
  int action;
  const char *priv;
  const char *address;
  const char *f[F_COUNT];
  const char *digest;
  const char *wrapped;
  const char *r;
  const char *s;
} vector_case;
static const vector_case CASES[] = {
${rows.join("\n")}
};
static const int CASE_COUNT = ${v.cases.length};
`;
writeFileSync(resolve(here, "../test/test_crypto/vectors.h"), out);
console.log(`wrote ${v.cases.length} cases`);
