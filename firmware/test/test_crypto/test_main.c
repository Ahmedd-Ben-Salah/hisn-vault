#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>
#include "hisn.h"
#include "keccak.h"
#include "sha256.h"
#include "vectors.h"
#include "uECC.h"

static hisn_ctx CTX;

void setUp(void) {}
void tearDown(void) {}

static uint64_t u64(const char *s) {
  return strtoull(s, NULL, 10);
}

static void bytes(const char *hex, uint8_t *out, size_t n) {
  TEST_ASSERT_EQUAL_INT(0, hisn_hex(hex, out, n));
}

static void addr(const char *hex, uint8_t out[20]) {
  bytes(hex, out, 20);
}

static void digest_for(const vector_case *c, uint8_t out[32]) {
  uint8_t to[20], token[20];
  hisn_word amount, fields[5];
  size_t n = 0;
  switch (c->action) {
    case HISN_PAY:
    case HISN_AGENT_PAY:
      addr(c->f[F_TO], to);
      addr(c->f[F_TOKEN], token);
      TEST_ASSERT_EQUAL_INT(0, hisn_word_dec(amount, c->f[F_AMOUNT]));
      hisn_digest_pay(&CTX, (uint8_t)c->action, to, token, amount, u64(c->f[F_NONCE]), u64(c->f[F_DEADLINE]), out);
      return;
    case HISN_VETO:
    case HISN_CANCEL:
    case HISN_APPROVE:
      hisn_digest_id(&CTX, (uint8_t)c->action, u64(c->f[F_PAYMENT_ID]), out);
      return;
    case HISN_FREEZE:
      hisn_digest_id(&CTX, HISN_FREEZE, u64(c->f[F_EPOCH]), out);
      return;
    case HISN_ALERT_ACK:
      hisn_digest_two(&CTX, HISN_ALERT_ACK, u64(c->f[F_PAYMENT_ID]), u64(c->f[F_NONCE]), out);
      return;
    case HISN_RECONFIRM:
      hisn_digest_reconfirm(&CTX, u64(c->f[F_PAYMENT_ID]), u64(c->f[F_NONCE]), u64(c->f[F_DEADLINE]), out);
      return;
    case HISN_RENEW_FREEZE:
      hisn_digest_two(&CTX, HISN_RENEW_FREEZE, u64(c->f[F_EPOCH]), u64(c->f[F_FROZEN_UNTIL]), out);
      return;
    case HISN_CHANGE: {
      int kind = atoi(c->f[F_KIND]);
      if (kind == 2) {
        uint8_t t[20];
        addr(c->f[F_TOKEN], t);
        hisn_word_addr(fields[0], t);
        hisn_word_dec(fields[1], c->f[F_INSTANT]);
        hisn_word_dec(fields[2], c->f[F_WAIT]);
        hisn_word_dec(fields[3], c->f[F_DAILY]);
        hisn_word_dec(fields[4], c->f[F_AGENT]);
        n = 5;
      } else if (kind != 9) {
        uint8_t a[20];
        addr(c->f[F_ADDRESS], a);
        hisn_word_addr(fields[0], a);
        n = 1;
      }
      hisn_digest_change(&CTX, (uint8_t)kind, u64(c->f[F_KEY_EPOCH]), (const hisn_word *)fields, n, u64(c->f[F_NONCE]), u64(c->f[F_DEADLINE]), out);
      return;
    }
    case HISN_CHANGE_APPROVE: {
      uint8_t h[32];
      bytes(c->f[F_DATA_HASH], h, 32);
      hisn_digest_change_approve(&CTX, u64(c->f[F_CHANGE_ID]), (uint8_t)atoi(c->f[F_KIND]), h, out);
      return;
    }
    case HISN_CHANGE_VETO:
      hisn_digest_id(&CTX, HISN_CHANGE_VETO, u64(c->f[F_CHANGE_ID]), out);
      return;
    default:
      TEST_FAIL_MESSAGE("unknown action");
  }
}

static void test_keccak_empty(void) {
  uint8_t h[32], want[32];
  hisn_keccak256((const uint8_t *)"", 0, h);
  bytes("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", want, 32);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, h, 32);
}

static void test_keccak_multiblock(void) {
  uint8_t data[300], a[32], b[32];
  for (int i = 0; i < 300; i++) data[i] = (uint8_t)i;
  hisn_keccak256(data, 300, a);
  hisn_keccak_ctx k;
  hisn_keccak_init(&k);
  hisn_keccak_update(&k, data, 137);
  hisn_keccak_update(&k, data + 137, 163);
  hisn_keccak_final(&k, b);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(a, b, 32);
}

static void test_sha256_abc(void) {
  uint8_t h[32], want[32];
  hisn_sha256((const uint8_t *)"abc", 3, h);
  bytes("0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", want, 32);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, h, 32);
}

static void test_vectors(void) {
  char msg[160];
  for (int i = 0; i < CASE_COUNT; i++) {
    const vector_case *c = &CASES[i];
    uint8_t d[32], want[32], w[32], priv[32], r[32], s[32], wr[32], ws[32], a[20], wa[20];
    digest_for(c, d);
    bytes(c->digest, want, 32);
    snprintf(msg, sizeof(msg), "%s digest", c->name);
    TEST_ASSERT_EQUAL_HEX8_ARRAY_MESSAGE(want, d, 32, msg);
    hisn_eip191(d, w);
    bytes(c->wrapped, want, 32);
    snprintf(msg, sizeof(msg), "%s eip191", c->name);
    TEST_ASSERT_EQUAL_HEX8_ARRAY_MESSAGE(want, w, 32, msg);
    bytes(c->priv, priv, 32);
    TEST_ASSERT_EQUAL_INT(0, hisn_sign(priv, w, r, s));
    uint8_t pub[64], sig[64];
    TEST_ASSERT_EQUAL_INT(1, uECC_compute_public_key(priv, pub, uECC_secp256k1()));
    memcpy(sig, r, 32);
    memcpy(sig + 32, s, 32);
    snprintf(msg, sizeof(msg), "%s own signature verifies", c->name);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, uECC_verify(pub, w, 32, sig, uECC_secp256k1()), msg);
    snprintf(msg, sizeof(msg), "%s low s", c->name);
    TEST_ASSERT_TRUE_MESSAGE(s[0] < 0x80, msg);
    bytes(c->r, wr, 32);
    bytes(c->s, ws, 32);
    memcpy(sig, wr, 32);
    memcpy(sig + 32, ws, 32);
    snprintf(msg, sizeof(msg), "%s ethers signature verifies", c->name);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, uECC_verify(pub, w, 32, sig, uECC_secp256k1()), msg);
    TEST_ASSERT_EQUAL_INT(0, hisn_address(priv, a));
    addr(c->address, wa);
    snprintf(msg, sizeof(msg), "%s address", c->name);
    TEST_ASSERT_EQUAL_HEX8_ARRAY_MESSAGE(wa, a, 20, msg);
  }
}

static void test_decimal_round_trip(void) {
  hisn_word w;
  char out[80];
  TEST_ASSERT_EQUAL_INT(0, hisn_word_dec(w, "115792089237316195423570985008687907853269984665640564039457584007913129639935"));
  TEST_ASSERT_EQUAL_INT(0, hisn_word_to_dec(w, out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("115792089237316195423570985008687907853269984665640564039457584007913129639935", out);
  TEST_ASSERT_EQUAL_INT(-1, hisn_word_dec(w, "115792089237316195423570985008687907853269984665640564039457584007913129639936"));
  TEST_ASSERT_EQUAL_INT(-1, hisn_word_dec(w, "12a"));
  TEST_ASSERT_EQUAL_INT(-1, hisn_word_dec(w, ""));
}

static void test_format_amount(void) {
  hisn_word w;
  char out[40];
  hisn_word_dec(w, "100000000");
  hisn_format_amount(w, 6, 2, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("100.00", out);
  hisn_word_dec(w, "50000000");
  hisn_format_amount(w, 8, 2, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("0.50", out);
  hisn_word_dec(w, "7");
  hisn_format_amount(w, 6, 2, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("0.00", out);
  hisn_word_dec(w, "123456789");
  hisn_format_amount(w, 6, 6, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("123.456789", out);
}

static void test_one_byte_changes_digest(void) {
  uint8_t to[20] = {0}, token[20] = {0}, a[32], b[32];
  hisn_word amt;
  hisn_word_dec(amt, "100000000");
  hisn_digest_pay(&CTX, HISN_PAY, to, token, amt, 1, 2, a);
  hisn_word_dec(amt, "100000001");
  hisn_digest_pay(&CTX, HISN_PAY, to, token, amt, 1, 2, b);
  TEST_ASSERT_FALSE(memcmp(a, b, 32) == 0);
}

int main(void) {
  CTX.chain_id = V_CHAIN_ID;
  hisn_hex(V_VAULT, CTX.vault, 20);
  UNITY_BEGIN();
  RUN_TEST(test_keccak_empty);
  RUN_TEST(test_keccak_multiblock);
  RUN_TEST(test_sha256_abc);
  RUN_TEST(test_vectors);
  RUN_TEST(test_decimal_round_trip);
  RUN_TEST(test_format_amount);
  RUN_TEST(test_one_byte_changes_digest);
  return UNITY_END();
}
