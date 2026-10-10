#include "util.h"
#include "keccak.h"

static const TokenInfo TOKENS[] = {
    {{0}, "HBAR", 8},
    {{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x06, 0x8c, 0xda}, "USDC", 6},
    {{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xa6, 0x1b, 0x55}, "USDC", 6},
};

#ifdef HISN_USDC_ADDRESS
static TokenInfo extraUsdc = {{0}, "USDC", 6};
static const bool extraOk = strlen(HISN_USDC_ADDRESS) == 42 && hisn_hex(HISN_USDC_ADDRESS, extraUsdc.address, 20) == 0;
#endif

const TokenInfo *tokenFind(const uint8_t addr[20]) {
  for (const auto &t : TOKENS)
    if (memcmp(t.address, addr, 20) == 0) return &t;
#ifdef HISN_USDC_ADDRESS
  if (extraOk && memcmp(extraUsdc.address, addr, 20) == 0) return &extraUsdc;
#endif
  return nullptr;
}

bool parseAddress(const char *hex, uint8_t out[20]) {
  if (!hex || strlen(hex) != 42) return false;
  return hisn_hex(hex, out, 20) == 0;
}

String checksumAddress(const uint8_t a[20]) {
  char hex[43];
  hisn_to_hex(a, 20, hex);
  uint8_t h[32];
  hisn_keccak256((const uint8_t *)hex + 2, 40, h);
  for (int i = 0; i < 40; i++) {
    char &c = hex[2 + i];
    int nibble = (h[i / 2] >> (i % 2 ? 0 : 4)) & 0xf;
    if (c >= 'a' && c <= 'f' && nibble >= 8) c = (char)(c - 32);
  }
  return String(hex);
}

String shortAddress(const uint8_t a[20]) {
  String s = checksumAddress(a);
  return s.substring(0, 10) + ".." + s.substring(34);
}

String formatToken(const hisn_word amount, const TokenInfo *t) {
  char buf[64];
  hisn_format_amount(amount, t->decimals, 2, buf, sizeof(buf));
  return String(buf) + " " + t->symbol;
}
