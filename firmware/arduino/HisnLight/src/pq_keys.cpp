#include "hisn_build.h"
#include "pq_keys.h"

#include <LittleFS.h>
#include <Preferences.h>

#include "hisn.h"
#include "keccak.h"
#include "keys.h"

static Preferences pp;
static uint8_t (*nodes)[32] = nullptr;
static hisn_pq_tree tree;
static bool ready = false;
static uint8_t loadedTag[32];
static const char *CACHE = "/pqtree.bin";

static void seedOf(const uint8_t priv[32], uint8_t seed[32]) {
  static const char tag[] = "HISN_PQ_SEED";
  hisn_keccak_ctx c;
  hisn_keccak_init(&c);
  hisn_keccak_update(&c, (const uint8_t *)tag, sizeof tag - 1);
  hisn_keccak_update(&c, priv, 32);
  hisn_keccak_final(&c, seed);
}

static void tagOf(const uint8_t seed[32], uint8_t out[32]) {
  static const char tag[] = "HISN_PQ_CACHE";
  hisn_keccak_ctx c;
  hisn_keccak_init(&c);
  hisn_keccak_update(&c, (const uint8_t *)tag, sizeof tag - 1);
  hisn_keccak_update(&c, seed, 32);
  hisn_keccak_final(&c, out);
}

static bool fsUp() {
  static int state = -1;
  if (state < 0) state = LittleFS.begin(true) ? 1 : 0;
  return state == 1;
}

static bool loadCache(const uint8_t tag[32]) {
  if (!fsUp() || !LittleFS.exists(CACHE)) return false;
  File f = LittleFS.open(CACHE, "r");
  if (!f) return false;
  const size_t want = HISN_PQ_NODES(HISN_PQ_HEIGHT) * 32;
  uint8_t head[32];
  bool ok = f.size() == 32 + want && f.read(head, 32) == 32 && memcmp(head, tag, 32) == 0 && f.read(&nodes[0][0], want) == want;
  f.close();
  return ok;
}

static void saveCache(const uint8_t tag[32]) {
  if (!fsUp()) return;
  File f = LittleFS.open(CACHE, "w");
  if (!f) return;
  const size_t want = HISN_PQ_NODES(HISN_PQ_HEIGHT) * 32;
  bool ok = f.write(tag, 32) == 32 && f.write(&nodes[0][0], want) == want;
  f.close();
  if (!ok) LittleFS.remove(CACHE);
}

static uint32_t nextLeaf() {
  pp.begin("hisnpq", true);
  uint32_t n = pp.getUInt("next", 0);
  pp.end();
  return n;
}

bool pqPrepare(const uint8_t priv[32]) {
  uint8_t seed[32], tag[32], root[32], old[32];
  seedOf(priv, seed);
  tagOf(seed, tag);
  if (ready && memcmp(tag, loadedTag, 32) == 0) {
    memset(seed, 0, 32);
    return true;
  }
  ready = false;
  if (!nodes) nodes = (uint8_t(*)[32])malloc(HISN_PQ_NODES(HISN_PQ_HEIGHT) * 32);
  if (!nodes) {
    memset(seed, 0, 32);
    return false;
  }
  if (loadCache(tag)) {
    tree.height = HISN_PQ_HEIGHT;
    tree.nodes = nodes;
    Serial.println("pq keys loaded from flash");
  } else {
    uint32_t t0 = millis();
    if (hisn_pq_tree_init(&tree, seed, HISN_PQ_HEIGHT, nodes) != 0) {
      memset(seed, 0, 32);
      return false;
    }
    Serial.printf("pq keys built in %lu ms\n", (unsigned long)(millis() - t0));
    saveCache(tag);
  }
  memset(tree.seed, 0, 32);
  memset(seed, 0, 32);
  memcpy(loadedTag, tag, 32);
  hisn_pq_root(&tree, root);
  pp.begin("hisnpq", false);
  bool same = pp.getBytes("root", old, 32) == 32 && memcmp(old, root, 32) == 0;
  if (!same) {
    // A new key (or a wiped puck): new one-time keys, counter from zero.
    pp.putBytes("root", root, 32);
    pp.putUInt("next", 0);
  }
  pp.end();
  ready = true;
  return true;
}

bool pqReady() {
  return ready;
}

bool pqStoredRoot(uint8_t root[32]) {
  pp.begin("hisnpq", true);
  bool ok = pp.getBytes("root", root, 32) == 32;
  pp.end();
  return ok;
}

uint32_t pqNext() {
  return nextLeaf();
}

bool pqSkipTo(uint32_t next) {
  uint32_t cap = 1u << HISN_PQ_HEIGHT;
  if (next > cap) next = cap;
  if (next <= nextLeaf()) return false;
  pp.begin("hisnpq", false);
  pp.putUInt("next", next);
  pp.end();
  return nextLeaf() == next;
}

uint32_t pqLeft() {
  uint32_t n = nextLeaf();
  uint32_t cap = 1u << HISN_PQ_HEIGHT;
  return n >= cap ? 0 : cap - n;
}

String pqSignHex(const uint8_t priv[32], uint64_t chainId, const uint8_t vault[20], const uint8_t digest[32]) {
  if (!pqPrepare(priv)) return String();
  uint32_t leaf = nextLeaf();
  if (leaf >= (1u << HISN_PQ_HEIGHT)) return String();
  // Commit first: if power fails after this line, the key is skipped, never reused.
  pp.begin("hisnpq", false);
  pp.putUInt("next", leaf + 1);
  pp.end();
  if (nextLeaf() != leaf + 1) return String();

  static uint8_t chains[HISN_PQ_LEN][32];
  static uint8_t path[HISN_PQ_HEIGHT][32];
  static uint8_t enc[(70 + HISN_PQ_HEIGHT) * 32];
  uint8_t seed[32];
  seedOf(priv, seed);
  memcpy(tree.seed, seed, 32);
  int rc = hisn_pq_sign(&tree, chainId, vault, leaf, digest, chains, path);
  memset(tree.seed, 0, 32);
  memset(seed, 0, 32);
  if (rc != 0) return String();
  size_t n = hisn_pq_encode(leaf, (const uint8_t(*)[32])chains, (const uint8_t(*)[32])path, HISN_PQ_HEIGHT, enc);
  memset(chains, 0, sizeof chains);
  char *hex = (char *)malloc(2 * n + 3);
  if (!hex) return String();
  hisn_to_hex(enc, n, hex); // writes "0x" + 2n digits + NUL
  String out(hex);
  free(hex);
  return out;
}
