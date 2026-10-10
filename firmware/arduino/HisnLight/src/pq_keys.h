#pragma once
// The puck's hash-based (post-quantum) keys. The seed is derived from the puck's PIN-protected key, so
// there is no second secret to store. The Merkle tree is public data and is rebuilt in RAM after boot.
#include <Arduino.h>
#include "hisn_pq.h"

#ifndef HISN_PQ_HEIGHT
#define HISN_PQ_HEIGHT 8 /* 256 one-time keys; a WAIT payment uses two (propose + confirm again) */
#endif

/** Builds the tree from the private key (about 10 to 20 s on an ESP32), and stores the root in flash. */
bool pqPrepare(const uint8_t priv[32]);
bool pqReady();
/** Root saved at the last pqPrepare, readable without the PIN (console `pq`), for the vault deploy. */
bool pqStoredRoot(uint8_t root[32]);
uint32_t pqLeft();
uint32_t pqNext();
bool pqSkipTo(uint32_t next);
/**
 * Signs `digest` with the next one-time key and returns the ABI-encoded signature as 0x-hex.
 * The next index is committed to flash before the signature leaves the device. Empty string when out of keys.
 */
String pqSignHex(const uint8_t priv[32], uint64_t chainId, const uint8_t vault[20], const uint8_t digest[32]);
