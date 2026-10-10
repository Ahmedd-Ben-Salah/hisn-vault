#pragma once
// Hash-based (post-quantum) one-time signatures for the puck: WOTS (w = 16, 67 chains) under a Merkle tree.
// Security rests only on Keccak-256. Byte layouts match shared/src/pq.ts and contracts/HisnPQVerifier.sol.
// A one-time key must never sign twice: persist the next leaf index BEFORE releasing a signature.
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HISN_PQ_LEN 67
#define HISN_PQ_MAX_HEIGHT 10

/** Number of 32-byte nodes a tree of `height` needs (all levels, leaves first). */
#define HISN_PQ_NODES(height) ((2u << (height)) - 1u)

typedef struct {
  uint8_t seed[32];
  uint8_t height;
  uint8_t (*nodes)[32]; /* HISN_PQ_NODES(height) entries, owned by the caller */
} hisn_pq_tree;

/** Builds the tree: 2^height * 67 * 15 Keccak calls. Returns 0, or -1 on a bad height. */
int hisn_pq_tree_init(hisn_pq_tree *t, const uint8_t seed[32], uint8_t height, uint8_t (*nodes)[32]);

void hisn_pq_root(const hisn_pq_tree *t, uint8_t out[32]);

/** Signs a vault digest with one-time key `leaf`. `path` receives `height` siblings. Returns 0 or -1. */
int hisn_pq_sign(const hisn_pq_tree *t, uint64_t chain_id, const uint8_t vault[20], uint32_t leaf,
                 const uint8_t digest[32], uint8_t chains[HISN_PQ_LEN][32], uint8_t path[][32]);

/** The root a signature leads to (what the vault compares with its stored root). */
void hisn_pq_root_of(uint64_t chain_id, const uint8_t vault[20], uint32_t leaf, const uint8_t digest[32],
                     const uint8_t chains[HISN_PQ_LEN][32], const uint8_t path[][32], uint8_t height, uint8_t out[32]);

/** ABI encoding of (uint32 leaf, bytes32[67] chains, bytes32[] path), as the vault's ...PQ functions take it.
 *  Needs (70 + height) * 32 bytes. Returns the length written. */
size_t hisn_pq_encode(uint32_t leaf, const uint8_t chains[HISN_PQ_LEN][32], const uint8_t path[][32], uint8_t height,
                      uint8_t *out);

#ifdef __cplusplus
}
#endif
