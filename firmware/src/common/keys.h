#pragma once
#include <Arduino.h>

enum UnlockResult { UNLOCK_OK = 0, UNLOCK_WRONG = -1, UNLOCK_WIPED = -2, UNLOCK_NO_KEY = -3 };

bool keyExists();
bool keyCreatePlain(uint8_t addr[20]);
bool keyImportPlain(const uint8_t priv[32], uint8_t addr[20]);
bool keyLoadPlain(uint8_t priv[32]);
bool keyCreateWithPin(const char *pin, uint8_t addr[20], const uint8_t *imported = nullptr);
UnlockResult keyUnlock(const char *pin, uint8_t priv[32]);
UnlockResult keyChangePin(const char *oldPin, const char *newPin);
int keyFailures();
bool keyAddress(uint8_t addr[20]);
void keyWipe();
#ifdef HISN_SIM
bool keyImportWithPin(const uint8_t key[32], const char *pin, uint8_t addr[20]);
#endif
void randomBytes(uint8_t *out, size_t n);
uint64_t randomU64();
bool parseKey(const char *hex, uint8_t priv[32]);
String hexString(const uint8_t *b, size_t n);
