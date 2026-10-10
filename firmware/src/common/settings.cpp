#include "settings.h"
#include <Preferences.h>
#include "hisn.h"

#ifndef HISN_WIFI_SSID
#define HISN_WIFI_SSID ""
#endif
#ifndef HISN_WIFI_PASS
#define HISN_WIFI_PASS ""
#endif
#ifndef HISN_WIFI2_SSID
#define HISN_WIFI2_SSID ""
#endif
#ifndef HISN_WIFI2_PASS
#define HISN_WIFI2_PASS ""
#endif
#ifndef HISN_RELAYER_HOST
#define HISN_RELAYER_HOST ""
#endif
#ifndef HISN_RELAYER_PORT
#define HISN_RELAYER_PORT 8787
#endif
#ifndef HISN_RELAYER_TOKEN
#define HISN_RELAYER_TOKEN ""
#endif
#ifndef HISN_VAULT_ADDRESS
#define HISN_VAULT_ADDRESS ""
#endif
#ifndef HISN_CHAIN_ID
#define HISN_CHAIN_ID 296
#endif

static Preferences prefs;

void settingsLoad(Settings &s) {
  prefs.begin("hisn", true);
  s.ssid[0] = prefs.getString("ssid0", HISN_WIFI_SSID);
  s.pass[0] = prefs.getString("pass0", HISN_WIFI_PASS);
  s.ssid[1] = prefs.getString("ssid1", HISN_WIFI2_SSID);
  s.pass[1] = prefs.getString("pass1", HISN_WIFI2_PASS);
  s.relayer = prefs.getString("relayer", HISN_RELAYER_HOST);
  s.port = prefs.getUShort("port", HISN_RELAYER_PORT);
  s.hasVault = prefs.getBytes("vault", s.vault, 20) == 20;
  s.chainId = prefs.getULong64("chain", HISN_CHAIN_ID);
  s.swapButtons = prefs.getBool("swapbtn", false);
  s.deviceId = prefs.getString("devid", "");
  s.token = prefs.getString("token", HISN_RELAYER_TOKEN);
  prefs.end();
  if (!s.hasVault && strlen(HISN_VAULT_ADDRESS) == 42 && hisn_hex(HISN_VAULT_ADDRESS, s.vault, 20) == 0) s.hasVault = true;
  if (s.deviceId.isEmpty()) {
    uint64_t mac = ESP.getEfuseMac();
    char id[24];
    snprintf(id, sizeof(id), "%s-%06lx", HISN_ROLE, (unsigned long)(mac & 0xffffff));
    s.deviceId = id;
  }
}

void settingsSave(const Settings &s) {
  prefs.begin("hisn", false);
  prefs.putString("ssid0", s.ssid[0]);
  prefs.putString("pass0", s.pass[0]);
  prefs.putString("ssid1", s.ssid[1]);
  prefs.putString("pass1", s.pass[1]);
  prefs.putString("relayer", s.relayer);
  prefs.putUShort("port", s.port);
  prefs.putString("token", s.token);
  if (s.hasVault) prefs.putBytes("vault", s.vault, 20);
  prefs.putULong64("chain", s.chainId);
  prefs.putBool("swapbtn", s.swapButtons);
  prefs.putString("devid", s.deviceId);
  prefs.end();
}

void settingsWipe() {
  prefs.begin("hisn", false);
  prefs.clear();
  prefs.end();
}
