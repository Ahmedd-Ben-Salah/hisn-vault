#include "keys.h"
#include <Preferences.h>
#include <esp_random.h>
#include <mbedtls/sha256.h>
#include <mbedtls/gcm.h>
#include "hisn.h"

static Preferences kp;
static const int MAX_FAILS = 10;
#ifdef HISN_SIM
static const int KDF_ROUNDS = 500;
#else
static const int KDF_ROUNDS = 50000;
#endif

void randomBytes(uint8_t *out, size_t n) {
  esp_fill_random(out, n);
}

uint64_t randomU64() {
  uint64_t v;
  randomBytes((uint8_t *)&v, 8);
  return v;
}

String hexString(const uint8_t *b, size_t n) {
  char buf[2 * 64 + 3];
  hisn_to_hex(b, n, buf);
  return String(buf);
}

static void newKey(uint8_t priv[32]) {
  do {
    randomBytes(priv, 32);
  } while (!hisn_valid_key(priv));
}

bool keyExists() {
  kp.begin("hisnkey", true);
  bool ok = kp.isKey("addr");
  kp.end();
  return ok;
}

bool keyAddress(uint8_t addr[20]) {
  kp.begin("hisnkey", true);
  bool ok = kp.getBytes("addr", addr, 20) == 20;
  kp.end();
  return ok;
}

bool parseKey(const char *hex, uint8_t priv[32]) {
  if (!hex) return false;
  size_t len = strlen(hex);
  bool prefixed = len >= 2 && hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X');
  if (len != (prefixed ? 66u : 64u)) return false;
  return hisn_hex(hex, priv, 32) == 0 && hisn_valid_key(priv);
}

static bool storePlain(uint8_t priv[32], uint8_t addr[20]) {
  if (hisn_address(priv, addr) != 0) return false;
  kp.begin("hisnkey", false);
  kp.putBytes("priv", priv, 32);
  kp.putBytes("addr", addr, 20);
  kp.end();
  memset(priv, 0, 32);
  return true;
}

bool keyCreatePlain(uint8_t addr[20]) {
  uint8_t priv[32];
  newKey(priv);
  return storePlain(priv, addr);
}

bool keyImportPlain(const uint8_t priv[32], uint8_t addr[20]) {
  uint8_t k[32];
  memcpy(k, priv, 32);
  if (!hisn_valid_key(k)) return false;
  return storePlain(k, addr);
}

bool keyLoadPlain(uint8_t priv[32]) {
  kp.begin("hisnkey", true);
  bool ok = kp.getBytes("priv", priv, 32) == 32;
  kp.end();
  return ok;
}

static void derive(const char *pin, const uint8_t salt[16], uint8_t out[32]) {
  uint8_t buf[32 + 16 + 16];
  size_t pinLen = strnlen(pin, 16);
  mbedtls_sha256_context c;
  mbedtls_sha256_init(&c);
  mbedtls_sha256_starts(&c, 0);
  mbedtls_sha256_update(&c, (const uint8_t *)pin, pinLen);
  mbedtls_sha256_update(&c, salt, 16);
  mbedtls_sha256_finish(&c, out);
  for (int i = 1; i < KDF_ROUNDS; i++) {
    memcpy(buf, out, 32);
    memcpy(buf + 32, salt, 16);
    memcpy(buf + 48, pin, pinLen);
    mbedtls_sha256_starts(&c, 0);
    mbedtls_sha256_update(&c, buf, 48 + pinLen);
    mbedtls_sha256_finish(&c, out);
  }
  mbedtls_sha256_free(&c);
  memset(buf, 0, sizeof(buf));
}

static bool storeWithPin(uint8_t priv[32], const char *pin, uint8_t addr[20]) {
  uint8_t salt[16], iv[12], ct[32], tag[16], k[32];
  if (hisn_address(priv, addr) != 0) return false;
  randomBytes(salt, 16);
  randomBytes(iv, 12);
  derive(pin, salt, k);
  mbedtls_gcm_context g;
  mbedtls_gcm_init(&g);
  mbedtls_gcm_setkey(&g, MBEDTLS_CIPHER_ID_AES, k, 256);
  int rc = mbedtls_gcm_crypt_and_tag(&g, MBEDTLS_GCM_ENCRYPT, 32, iv, 12, addr, 20, priv, ct, 16, tag);
  mbedtls_gcm_free(&g);
  memset(priv, 0, 32);
  memset(k, 0, 32);
  if (rc != 0) return false;
  kp.begin("hisnkey", false);
  kp.putBytes("salt", salt, 16);
  kp.putBytes("iv", iv, 12);
  kp.putBytes("ct", ct, 32);
  kp.putBytes("tag", tag, 16);
  kp.putBytes("addr", addr, 20);
  kp.putInt("fails", 0);
  kp.end();
  return true;
}

bool keyCreateWithPin(const char *pin, uint8_t addr[20], const uint8_t *imported) {
  uint8_t priv[32];
  if (imported && hisn_valid_key(imported)) memcpy(priv, imported, 32);
  else newKey(priv);
  bool ok = storeWithPin(priv, pin, addr);
  memset(priv, 0, 32);
  return ok;
}

UnlockResult keyChangePin(const char *oldPin, const char *newPin) {
  uint8_t priv[32], addr[20];
  UnlockResult r = keyUnlock(oldPin, priv);
  if (r != UNLOCK_OK) return r;
  bool ok = storeWithPin(priv, newPin, addr);
  memset(priv, 0, 32);
  return ok ? UNLOCK_OK : UNLOCK_WRONG;
}

#ifdef HISN_SIM
bool keyImportWithPin(const uint8_t key[32], const char *pin, uint8_t addr[20]) {
  uint8_t priv[32];
  memcpy(priv, key, 32);
  bool ok = storeWithPin(priv, pin, addr);
  memset(priv, 0, 32);
  return ok;
}
#endif

int keyFailures() {
  kp.begin("hisnkey", true);
  int f = kp.getInt("fails", 0);
  kp.end();
  return f;
}

void keyWipe() {
  kp.begin("hisnkey", false);
  kp.clear();
  kp.end();
}

UnlockResult keyUnlock(const char *pin, uint8_t priv[32]) {
  uint8_t salt[16], iv[12], ct[32], tag[16], addr[20], k[32], check[20];
  kp.begin("hisnkey", true);
  bool ok = kp.getBytes("salt", salt, 16) == 16 && kp.getBytes("iv", iv, 12) == 12 && kp.getBytes("ct", ct, 32) == 32 &&
            kp.getBytes("tag", tag, 16) == 16 && kp.getBytes("addr", addr, 20) == 20;
  kp.end();
  if (!ok) return UNLOCK_NO_KEY;
  derive(pin, salt, k);
  mbedtls_gcm_context g;
  mbedtls_gcm_init(&g);
  mbedtls_gcm_setkey(&g, MBEDTLS_CIPHER_ID_AES, k, 256);
  int rc = mbedtls_gcm_auth_decrypt(&g, 32, iv, 12, addr, 20, tag, 16, ct, priv);
  mbedtls_gcm_free(&g);
  memset(k, 0, 32);
  if (rc == 0 && hisn_address(priv, check) == 0 && memcmp(check, addr, 20) == 0) {
    kp.begin("hisnkey", false);
    kp.putInt("fails", 0);
    kp.end();
    return UNLOCK_OK;
  }
  memset(priv, 0, 32);
  kp.begin("hisnkey", false);
  int fails = kp.getInt("fails", 0) + 1;
  kp.putInt("fails", fails);
  kp.end();
  if (fails >= MAX_FAILS) {
    keyWipe();
    return UNLOCK_WIPED;
  }
  return UNLOCK_WRONG;
}
