#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint32_t h[8];
  uint8_t buf[64];
  uint64_t len;
  size_t n;
} hisn_sha256_ctx;

void hisn_sha256_init(hisn_sha256_ctx *c);
void hisn_sha256_update(hisn_sha256_ctx *c, const uint8_t *data, size_t len);
void hisn_sha256_final(hisn_sha256_ctx *c, uint8_t out[32]);
void hisn_sha256(const uint8_t *data, size_t len, uint8_t out[32]);

#ifdef __cplusplus
}
#endif
