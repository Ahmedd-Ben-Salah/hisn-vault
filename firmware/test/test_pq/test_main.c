// Checks the firmware's hash-based signatures against vectors from the TypeScript reference (shared/src/pq.ts).
#include <stdlib.h>
#include <string.h>
#include <unity.h>
#include "hisn.h"
#include "hisn_pq.h"
#include "pq_vectors.h"

static hisn_pq_tree T;
static uint8_t NODES[HISN_PQ_NODES(PQV_HEIGHT)][32];
static uint8_t SEED[32], VAULT[20];

void setUp(void) {}
void tearDown(void) {}

static void test_root_matches_typescript(void) {
  uint8_t root[32], want[32];
  TEST_ASSERT_EQUAL_INT(0, hisn_hex(PQV_ROOT, want, 32));
  hisn_pq_root(&T, root);
  TEST_ASSERT_EQUAL_MEMORY(want, root, 32);
}

static void test_signatures_match_typescript_byte_for_byte(void) {
  static uint8_t chains[HISN_PQ_LEN][32], path[PQV_HEIGHT][32], enc[(70 + PQV_HEIGHT) * 32], want[(70 + PQV_HEIGHT) * 32];
  for (size_t k = 0; k < sizeof PQV_CASES / sizeof PQV_CASES[0]; k++) {
    uint8_t digest[32];
    TEST_ASSERT_EQUAL_INT(0, hisn_hex(PQV_CASES[k].digest, digest, 32));
    TEST_ASSERT_EQUAL_INT(0, hisn_pq_sign(&T, PQV_CHAIN_ID, VAULT, PQV_CASES[k].leaf, digest, chains, path));
    size_t n = hisn_pq_encode(PQV_CASES[k].leaf, (const uint8_t(*)[32])chains, (const uint8_t(*)[32])path, PQV_HEIGHT, enc);
    TEST_ASSERT_EQUAL_size_t(sizeof want, n);
    TEST_ASSERT_EQUAL_INT(0, hisn_hex(PQV_CASES[k].encoded, want, n));
    TEST_ASSERT_EQUAL_MEMORY(want, enc, n);
  }
}

static void test_verify_round_trip_and_tamper(void) {
  static uint8_t chains[HISN_PQ_LEN][32], path[PQV_HEIGHT][32];
  uint8_t digest[32] = {7}, root[32], got[32];
  hisn_pq_root(&T, root);
  hisn_pq_sign(&T, PQV_CHAIN_ID, VAULT, 3, digest, chains, path);
  hisn_pq_root_of(PQV_CHAIN_ID, VAULT, 3, digest, (const uint8_t(*)[32])chains, (const uint8_t(*)[32])path, PQV_HEIGHT, got);
  TEST_ASSERT_EQUAL_MEMORY(root, got, 32);
  digest[0] ^= 1;
  hisn_pq_root_of(PQV_CHAIN_ID, VAULT, 3, digest, (const uint8_t(*)[32])chains, (const uint8_t(*)[32])path, PQV_HEIGHT, got);
  TEST_ASSERT_FALSE(memcmp(root, got, 32) == 0);
}

static void test_refuses_out_of_range_leaf(void) {
  static uint8_t chains[HISN_PQ_LEN][32], path[PQV_HEIGHT][32];
  uint8_t digest[32] = {0};
  TEST_ASSERT_EQUAL_INT(-1, hisn_pq_sign(&T, PQV_CHAIN_ID, VAULT, 1u << PQV_HEIGHT, digest, chains, path));
}

int main(void) {
  hisn_hex(PQV_SEED, SEED, 32);
  hisn_hex(PQV_VAULT, VAULT, 20);
  hisn_pq_tree_init(&T, SEED, PQV_HEIGHT, NODES);
  UNITY_BEGIN();
  RUN_TEST(test_root_matches_typescript);
  RUN_TEST(test_signatures_match_typescript_byte_for_byte);
  RUN_TEST(test_verify_round_trip_and_tamper);
  RUN_TEST(test_refuses_out_of_range_leaf);
  return UNITY_END();
}
