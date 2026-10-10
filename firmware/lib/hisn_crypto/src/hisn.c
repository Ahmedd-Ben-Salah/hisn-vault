#include "hisn.h"
#include "keccak.h"
#include "sha256.h"
#include <string.h>
#include "uECC.h"

static const uint8_t N[32] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
                              0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41};
static const uint8_t HALF_N[32] = {0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                                   0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0};

void hisn_word_u64(hisn_word w, uint64_t v) {
  memset(w, 0, 32);
  for (int i = 0; i < 8; i++) w[31 - i] = (uint8_t)(v >> (8 * i));
}

void hisn_word_addr(hisn_word w, const uint8_t addr[20]) {
  memset(w, 0, 12);
  memcpy(w + 12, addr, 20);
}

int hisn_word_dec(hisn_word w, const char *dec) {
  memset(w, 0, 32);
  if (!dec || !*dec) return -1;
  for (const char *p = dec; *p; p++) {
    if (*p < '0' || *p > '9') return -1;
    unsigned carry = (unsigned)(*p - '0');
    for (int i = 31; i >= 0; i--) {
      unsigned v = (unsigned)w[i] * 10 + carry;
      w[i] = (uint8_t)v;
      carry = v >> 8;
    }
    if (carry) return -1;
  }
  return 0;
}

int hisn_word_to_dec(const hisn_word w, char *out, size_t cap) {
  uint8_t t[32];
  char tmp[80];
  size_t n = 0;
  memcpy(t, w, 32);
  for (;;) {
    int zero = 1;
    unsigned rem = 0;
    for (int i = 0; i < 32; i++) {
      unsigned v = (rem << 8) | t[i];
      t[i] = (uint8_t)(v / 10);
      rem = v % 10;
      if (t[i]) zero = 0;
    }
    tmp[n++] = (char)('0' + rem);
    if (zero) break;
  }
  if (n + 1 > cap) return -1;
  for (size_t i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
  out[n] = 0;
  return 0;
}

static int nib(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

int hisn_hex(const char *hex, uint8_t *out, size_t n) {
  if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;
  size_t len = strlen(hex);
  if (len > 2 * n) return -1;
  memset(out, 0, n);
  size_t start = 2 * n - len;
  for (size_t i = 0; i < len; i++) {
    int v = nib(hex[i]);
    if (v < 0) return -1;
    size_t pos = start + i;
    out[pos / 2] |= (uint8_t)(pos % 2 ? v : v << 4);
  }
  return 0;
}

void hisn_to_hex(const uint8_t *in, size_t n, char *out) {
  static const char H[] = "0123456789abcdef";
  *out++ = '0';
  *out++ = 'x';
  for (size_t i = 0; i < n; i++) {
    *out++ = H[in[i] >> 4];
    *out++ = H[in[i] & 15];
  }
  *out = 0;
}

static void tag(uint8_t out[32]) {
  static uint8_t t[32];
  static int done = 0;
  if (!done) {
    hisn_keccak256((const uint8_t *)"HISN_V1", 7, t);
    done = 1;
  }
  memcpy(out, t, 32);
}

void hisn_digest_words(const hisn_ctx *ctx, uint8_t action, const hisn_word *words, size_t n, uint8_t out[32]) {
  hisn_keccak_ctx k;
  hisn_word w;
  hisn_keccak_init(&k);
  tag(w);
  hisn_keccak_update(&k, w, 32);
  hisn_word_u64(w, ctx->chain_id);
  hisn_keccak_update(&k, w, 32);
  hisn_word_addr(w, ctx->vault);
  hisn_keccak_update(&k, w, 32);
  hisn_word_u64(w, action);
  hisn_keccak_update(&k, w, 32);
  for (size_t i = 0; i < n; i++) hisn_keccak_update(&k, words[i], 32);
  hisn_keccak_final(&k, out);
}

void hisn_digest_pay(const hisn_ctx *ctx, uint8_t action, const uint8_t to[20], const uint8_t token[20], const hisn_word amount, uint64_t nonce, uint64_t deadline, uint8_t out[32]) {
  hisn_word w[5];
  hisn_word_addr(w[0], to);
  hisn_word_addr(w[1], token);
  memcpy(w[2], amount, 32);
  hisn_word_u64(w[3], nonce);
  hisn_word_u64(w[4], deadline);
  hisn_digest_words(ctx, action, (const hisn_word *)w, 5, out);
}

void hisn_digest_id(const hisn_ctx *ctx, uint8_t action, uint64_t id, uint8_t out[32]) {
  hisn_word w[1];
  hisn_word_u64(w[0], id);
  hisn_digest_words(ctx, action, (const hisn_word *)w, 1, out);
}

void hisn_digest_two(const hisn_ctx *ctx, uint8_t action, uint64_t a, uint64_t b, uint8_t out[32]) {
  hisn_word w[2];
  hisn_word_u64(w[0], a);
  hisn_word_u64(w[1], b);
  hisn_digest_words(ctx, action, (const hisn_word *)w, 2, out);
}

void hisn_digest_reconfirm(const hisn_ctx *ctx, uint64_t id, uint64_t nonce, uint64_t deadline, uint8_t out[32]) {
  hisn_word w[3];
  hisn_word_u64(w[0], id);
  hisn_word_u64(w[1], nonce);
  hisn_word_u64(w[2], deadline);
  hisn_digest_words(ctx, HISN_RECONFIRM, (const hisn_word *)w, 3, out);
}

void hisn_digest_change(const hisn_ctx *ctx, uint8_t kind, uint64_t key_epoch, const hisn_word *fields, size_t n, uint64_t nonce, uint64_t deadline, uint8_t out[32]) {
  hisn_word w[9];
  if (n > 5) n = 5;
  hisn_word_u64(w[0], kind);
  hisn_word_u64(w[1], key_epoch);
  for (size_t i = 0; i < n; i++) memcpy(w[2 + i], fields[i], 32);
  hisn_word_u64(w[2 + n], nonce);
  hisn_word_u64(w[3 + n], deadline);
  hisn_digest_words(ctx, HISN_CHANGE, (const hisn_word *)w, 4 + n, out);
}

void hisn_digest_change_approve(const hisn_ctx *ctx, uint64_t change_id, uint8_t kind, const uint8_t data_hash[32], uint8_t out[32]) {
  hisn_word w[3];
  hisn_word_u64(w[0], change_id);
  hisn_word_u64(w[1], kind);
  memcpy(w[2], data_hash, 32);
  hisn_digest_words(ctx, HISN_CHANGE_APPROVE, (const hisn_word *)w, 3, out);
}

void hisn_eip191(const uint8_t digest[32], uint8_t out[32]) {
  static const char P[] = "\x19" "Ethereum Signed Message:\n32";
  hisn_keccak_ctx k;
  hisn_keccak_init(&k);
  hisn_keccak_update(&k, (const uint8_t *)P, sizeof(P) - 1);
  hisn_keccak_update(&k, digest, 32);
  hisn_keccak_final(&k, out);
}

typedef struct {
  uECC_HashContext uECC;
  hisn_sha256_ctx ctx;
  uint8_t tmp[128];
} hmac_ctx;

static void h_init(const uECC_HashContext *b) {
  hisn_sha256_init(&((hmac_ctx *)b)->ctx);
}

static void h_update(const uECC_HashContext *b, const uint8_t *m, unsigned n) {
  hisn_sha256_update(&((hmac_ctx *)b)->ctx, m, n);
}

static void h_finish(const uECC_HashContext *b, uint8_t *out) {
  hisn_sha256_final(&((hmac_ctx *)b)->ctx, out);
}

static int greater(const uint8_t a[32], const uint8_t b[32]) {
  for (int i = 0; i < 32; i++) {
    if (a[i] != b[i]) return a[i] > b[i];
  }
  return 0;
}

static void sub_from_n(uint8_t s[32]) {
  int borrow = 0;
  for (int i = 31; i >= 0; i--) {
    int v = (int)N[i] - (int)s[i] - borrow;
    borrow = v < 0;
    s[i] = (uint8_t)(v + (borrow ? 256 : 0));
  }
}

int hisn_sign(const uint8_t priv[32], const uint8_t hash[32], uint8_t r[32], uint8_t s[32]) {
  uint8_t sig[64];
  hmac_ctx h;
  memset(&h, 0, sizeof(h));
  h.uECC.init_hash = h_init;
  h.uECC.update_hash = h_update;
  h.uECC.finish_hash = h_finish;
  h.uECC.block_size = 64;
  h.uECC.result_size = 32;
  h.uECC.tmp = h.tmp;
  if (!uECC_sign_deterministic(priv, hash, 32, &h.uECC, sig, uECC_secp256k1())) return -1;
  memcpy(r, sig, 32);
  memcpy(s, sig + 32, 32);
  if (greater(s, HALF_N)) sub_from_n(s);
  memset(sig, 0, sizeof(sig));
  memset(&h, 0, sizeof(h));
  return 0;
}

int hisn_valid_key(const uint8_t priv[32]) {
  static const uint8_t Z[32] = {0};
  return memcmp(priv, Z, 32) != 0 && greater(N, priv);
}

int hisn_address(const uint8_t priv[32], uint8_t addr[20]) {
  uint8_t pub[64], h[32];
  if (!uECC_compute_public_key(priv, pub, uECC_secp256k1())) return -1;
  hisn_keccak256(pub, 64, h);
  memcpy(addr, h + 12, 20);
  return 0;
}

void hisn_format_amount(const hisn_word amount, int decimals, int places, char *out, size_t cap) {
  char d[80];
  if (hisn_word_to_dec(amount, d, sizeof(d)) != 0) {
    if (cap) out[0] = 0;
    return;
  }
  size_t len = strlen(d);
  char padded[100];
  size_t need = (size_t)decimals + 1;
  size_t pad = len < need ? need - len : 0;
  memset(padded, '0', pad);
  memcpy(padded + pad, d, len + 1);
  len += pad;
  size_t whole = len - (size_t)decimals;
  size_t o = 0;
  for (size_t i = 0; i < whole && o + 1 < cap; i++) out[o++] = padded[i];
  if (places > 0 && o + 1 < cap) {
    out[o++] = '.';
    for (int i = 0; i < places && o + 1 < cap; i++) out[o++] = i < decimals ? padded[whole + (size_t)i] : '0';
  }
  out[o] = 0;
}
