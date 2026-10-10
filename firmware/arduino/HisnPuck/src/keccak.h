#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint64_t st[25];
  size_t pt;
} hisn_keccak_ctx;

void hisn_keccak_init(hisn_keccak_ctx *c);
void hisn_keccak_update(hisn_keccak_ctx *c, const uint8_t *data, size_t len);
void hisn_keccak_final(hisn_keccak_ctx *c, uint8_t out[32]);
void hisn_keccak256(const uint8_t *data, size_t len, uint8_t out[32]);

#ifdef __cplusplus
}
#endif
