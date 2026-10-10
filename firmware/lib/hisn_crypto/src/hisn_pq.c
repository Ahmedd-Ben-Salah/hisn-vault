#include "hisn_pq.h"

#include <string.h>

#include "keccak.h"

#define W 16

static void put_u32(uint8_t *o, uint32_t v) {
  o[0] = (uint8_t)(v >> 24);
  o[1] = (uint8_t)(v >> 16);
  o[2] = (uint8_t)(v >> 8);
  o[3] = (uint8_t)v;
}

/* sk(i) = keccak256(0x00 || seed || leaf || i) */
static void sk_of(const uint8_t seed[32], uint32_t leaf, uint8_t i, uint8_t out[32]) {
  uint8_t b[1 + 32 + 4 + 1];
  b[0] = 0;
  memcpy(b + 1, seed, 32);
  put_u32(b + 33, leaf);
  b[37] = i;
  hisn_keccak256(b, sizeof b, out);
}

/* F(x) = keccak256(0x01 || leaf || i || j || x), applied from position `from` for `steps` steps. */
static void chain(uint8_t x[32], uint32_t leaf, uint8_t i, unsigned from, unsigned steps) {
  uint8_t b[1 + 4 + 1 + 1 + 32];
  b[0] = 1;
  put_u32(b + 1, leaf);
  b[5] = i;
  for (unsigned j = from; j < from + steps; j++) {
    b[6] = (uint8_t)j;
    memcpy(b + 7, x, 32);
    hisn_keccak256(b, sizeof b, x);
  }
}

static void node(const uint8_t l[32], const uint8_t r[32], uint8_t out[32]) {
  uint8_t b[65];
  b[0] = 3;
  memcpy(b + 1, l, 32);
  memcpy(b + 33, r, 32);
  hisn_keccak256(b, sizeof b, out);
}

/* message = keccak256(PQ_TAG || chainId[32] || vault[20] || leaf[4] || digest[32]); digits + checksum */
static void digits_of(uint64_t chain_id, const uint8_t vault[20], uint32_t leaf, const uint8_t digest[32],
                      uint8_t d[HISN_PQ_LEN]) {
  static const char tag_text[] = "HISN_PQ_V1";
  uint8_t tag[32], m[32], cid[32] = {0};
  hisn_keccak256((const uint8_t *)tag_text, sizeof tag_text - 1, tag);
  for (int k = 0; k < 8; k++) cid[31 - k] = (uint8_t)(chain_id >> (8 * k));
  uint8_t lb[4];
  put_u32(lb, leaf);
  hisn_keccak_ctx c;
  hisn_keccak_init(&c);
  hisn_keccak_update(&c, tag, 32);
  hisn_keccak_update(&c, cid, 32);
  hisn_keccak_update(&c, vault, 20);
  hisn_keccak_update(&c, lb, 4);
  hisn_keccak_update(&c, digest, 32);
  hisn_keccak_final(&c, m);
  unsigned csum = 0;
  for (int k = 0; k < 32; k++) {
    d[2 * k] = m[k] >> 4;
    d[2 * k + 1] = m[k] & 15;
  }
  for (int k = 0; k < 64; k++) csum += 15u - d[k];
  d[64] = (csum >> 8) & 15;
  d[65] = (csum >> 4) & 15;
  d[66] = csum & 15;
}

static void leaf_hash(uint8_t ends[HISN_PQ_LEN][32], uint8_t out[32]) {
  const uint8_t pre = 2;
  hisn_keccak_ctx c;
  hisn_keccak_init(&c);
  hisn_keccak_update(&c, &pre, 1);
  hisn_keccak_update(&c, &ends[0][0], HISN_PQ_LEN * 32);
  hisn_keccak_final(&c, out);
}

/* Level `h` starts at offset sum_{k<h} 2^(height-k). */
static size_t level_off(uint8_t height, uint8_t h) {
  size_t off = 0;
  for (uint8_t k = 0; k < h; k++) off += (size_t)1 << (height - k);
  return off;
}

int hisn_pq_tree_init(hisn_pq_tree *t, const uint8_t seed[32], uint8_t height, uint8_t (*nodes)[32]) {
  if (height < 1 || height > HISN_PQ_MAX_HEIGHT) return -1;
  memcpy(t->seed, seed, 32);
  t->height = height;
  t->nodes = nodes;
  uint8_t ends[HISN_PQ_LEN][32];
  uint32_t n = 1u << height;
  for (uint32_t leaf = 0; leaf < n; leaf++) {
    for (uint8_t i = 0; i < HISN_PQ_LEN; i++) {
      sk_of(seed, leaf, i, ends[i]);
      chain(ends[i], leaf, i, 0, W - 1);
    }
    leaf_hash(ends, nodes[leaf]);
  }
  for (uint8_t h = 0; h < height; h++) {
    size_t below = level_off(height, h), up = level_off(height, h + 1);
    size_t count = (size_t)1 << (height - h - 1);
    for (size_t k = 0; k < count; k++) node(nodes[below + 2 * k], nodes[below + 2 * k + 1], nodes[up + k]);
  }
  memset(ends, 0, sizeof ends);
  return 0;
}

void hisn_pq_root(const hisn_pq_tree *t, uint8_t out[32]) {
  memcpy(out, t->nodes[level_off(t->height, t->height)], 32);
}

int hisn_pq_sign(const hisn_pq_tree *t, uint64_t chain_id, const uint8_t vault[20], uint32_t leaf,
                 const uint8_t digest[32], uint8_t chains[HISN_PQ_LEN][32], uint8_t path[][32]) {
  if (leaf >= (1u << t->height)) return -1;
  uint8_t d[HISN_PQ_LEN];
  digits_of(chain_id, vault, leaf, digest, d);
  for (uint8_t i = 0; i < HISN_PQ_LEN; i++) {
    sk_of(t->seed, leaf, i, chains[i]);
    chain(chains[i], leaf, i, 0, d[i]);
  }
  uint32_t idx = leaf;
  for (uint8_t h = 0; h < t->height; h++) {
    memcpy(path[h], t->nodes[level_off(t->height, h) + (idx ^ 1u)], 32);
    idx >>= 1;
  }
  return 0;
}

void hisn_pq_root_of(uint64_t chain_id, const uint8_t vault[20], uint32_t leaf, const uint8_t digest[32],
                     const uint8_t chains[HISN_PQ_LEN][32], const uint8_t path[][32], uint8_t height, uint8_t out[32]) {
  uint8_t d[HISN_PQ_LEN], ends[HISN_PQ_LEN][32];
  digits_of(chain_id, vault, leaf, digest, d);
  for (uint8_t i = 0; i < HISN_PQ_LEN; i++) {
    memcpy(ends[i], chains[i], 32);
    chain(ends[i], leaf, i, d[i], (W - 1) - d[i]);
  }
  leaf_hash(ends, out);
  uint32_t idx = leaf;
  for (uint8_t h = 0; h < height; h++) {
    if (idx & 1u)
      node(path[h], out, out);
    else
      node(out, path[h], out);
    idx >>= 1;
  }
}

static void word_u32(uint8_t *o, uint32_t v) {
  memset(o, 0, 32);
  put_u32(o + 28, v);
}

size_t hisn_pq_encode(uint32_t leaf, const uint8_t chains[HISN_PQ_LEN][32], const uint8_t path[][32], uint8_t height,
                      uint8_t *out) {
  uint8_t *o = out;
  word_u32(o, leaf);
  o += 32;
  memcpy(o, chains, HISN_PQ_LEN * 32);
  o += HISN_PQ_LEN * 32;
  word_u32(o, (1 + HISN_PQ_LEN + 1) * 32); /* offset of the dynamic path array */
  o += 32;
  word_u32(o, height);
  o += 32;
  memcpy(o, path, (size_t)height * 32);
  o += (size_t)height * 32;
  return (size_t)(o - out);
}
