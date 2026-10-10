#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  HISN_PAY = 1,
  HISN_AGENT_PAY = 2,
  HISN_VETO = 3,
  HISN_CANCEL = 4,
  HISN_APPROVE = 5,
  HISN_FREEZE = 6,
  HISN_CHANGE = 7,
  HISN_CHANGE_APPROVE = 8,
  HISN_CHANGE_VETO = 9,
  HISN_ALERT_ACK = 10,
  HISN_RECONFIRM = 11,
  HISN_RENEW_FREEZE = 12
};

typedef uint8_t hisn_word[32];

typedef struct {
  uint8_t vault[20];
  uint64_t chain_id;
} hisn_ctx;

void hisn_word_u64(hisn_word w, uint64_t v);
void hisn_word_addr(hisn_word w, const uint8_t addr[20]);
int hisn_word_dec(hisn_word w, const char *dec);
int hisn_word_to_dec(const hisn_word w, char *out, size_t cap);
int hisn_hex(const char *hex, uint8_t *out, size_t n);
void hisn_to_hex(const uint8_t *in, size_t n, char *out);

void hisn_digest_words(const hisn_ctx *ctx, uint8_t action, const hisn_word *words, size_t n, uint8_t out[32]);
void hisn_digest_pay(const hisn_ctx *ctx, uint8_t action, const uint8_t to[20], const uint8_t token[20], const hisn_word amount, uint64_t nonce, uint64_t deadline, uint8_t out[32]);
void hisn_digest_id(const hisn_ctx *ctx, uint8_t action, uint64_t id, uint8_t out[32]);
void hisn_digest_two(const hisn_ctx *ctx, uint8_t action, uint64_t a, uint64_t b, uint8_t out[32]);
void hisn_digest_reconfirm(const hisn_ctx *ctx, uint64_t id, uint64_t nonce, uint64_t deadline, uint8_t out[32]);
void hisn_digest_change(const hisn_ctx *ctx, uint8_t kind, uint64_t key_epoch, const hisn_word *fields, size_t n, uint64_t nonce, uint64_t deadline, uint8_t out[32]);
void hisn_digest_change_approve(const hisn_ctx *ctx, uint64_t change_id, uint8_t kind, const uint8_t data_hash[32], uint8_t out[32]);

void hisn_eip191(const uint8_t digest[32], uint8_t out[32]);
int hisn_sign(const uint8_t priv[32], const uint8_t hash[32], uint8_t r[32], uint8_t s[32]);
int hisn_address(const uint8_t priv[32], uint8_t addr[20]);
int hisn_valid_key(const uint8_t priv[32]);

void hisn_format_amount(const hisn_word amount, int decimals, int places, char *out, size_t cap);

#ifdef __cplusplus
}
#endif
