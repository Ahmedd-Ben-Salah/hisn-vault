#pragma once
#include <Arduino.h>
#include "hisn.h"

struct TokenInfo {
  uint8_t address[20];
  const char *symbol;
  int decimals;
};

const TokenInfo *tokenFind(const uint8_t addr[20]);
bool parseAddress(const char *hex, uint8_t out[20]);
String checksumAddress(const uint8_t a[20]);
String shortAddress(const uint8_t a[20]);
String formatToken(const hisn_word amount, const TokenInfo *t);
