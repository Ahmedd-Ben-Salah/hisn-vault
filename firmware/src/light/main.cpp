#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include "hisn.h"
#include "../common/settings.h"
#include "../common/link.h"
#include "../common/keys.h"
#include "../common/console.h"
#include "../common/util.h"

#ifndef PIN_RED
#define PIN_RED 18
#endif
#ifndef PIN_GREEN
#define PIN_GREEN 19
#endif
#ifndef PIN_BUZZ
#define PIN_BUZZ 26
#endif
#ifndef PIN_VETO
#define PIN_VETO 27
#endif

static Settings cfg;
static uint8_t priv[32];
static uint8_t myAddr[20];
static String myAddrStr;
static uint32_t epoch = 0;

struct Alarm {
  bool used;
  bool isChange;
  uint32_t id;
  bool approval;
  uint64_t releaseAt;
  bool clearedElsewhere;
  bool myStopSent;
  uint32_t lastTry;
};

static const int MAX_ALARMS = 8;
static Alarm alarms[MAX_ALARMS];

enum Mode { M_CALM, M_ALARM_WAIT, M_ALARM_APPROVAL, M_ALARM_CHANGE, M_DIM, M_VETOING, M_LOST };

static uint32_t pressStart = 0;
static bool pressing = false;
static bool vetoFired = false;
static bool freezeFired = false;
static uint32_t lastBeep = 0;
static uint32_t okFlashUntil = 0;

static hisn_ctx ctx() {
  hisn_ctx c;
  memcpy(c.vault, cfg.vault, 20);
  c.chain_id = cfg.chainId;
  return c;
}

static void signInto(JsonDocument &m, const uint8_t digest[32]) {
  uint8_t w[32], r[32], s[32];
  hisn_eip191(digest, w);
  hisn_sign(priv, w, r, s);
  m["r"] = hexString(r, 32);
  m["s"] = hexString(s, 32);
}

static Alarm *find(bool isChange, uint32_t id) {
  for (auto &a : alarms)
    if (a.used && a.isChange == isChange && a.id == id) return &a;
  return nullptr;
}

static Alarm *add(bool isChange, uint32_t id) {
  Alarm *a = find(isChange, id);
  if (a) return a;
  for (auto &x : alarms) {
    if (!x.used) {
      x = Alarm{};
      x.used = true;
      x.isChange = isChange;
      x.id = id;
      return &x;
    }
  }
  return nullptr;
}

static void sendAck(uint32_t paymentId) {
  hisn_ctx c = ctx();
  uint64_t nonce = randomU64();
  uint8_t d[32];
  hisn_digest_two(&c, HISN_ALERT_ACK, paymentId, nonce, d);
  JsonDocument m;
  char nh[19];
  snprintf(nh, sizeof(nh), "0x%llx", (unsigned long long)nonce);
  m["t"] = "ack";
  m["paymentId"] = paymentId;
  m["nonce"] = nh;
  signInto(m, d);
  linkSend(m);
}

static void sendStop(Alarm &a) {
  hisn_ctx c = ctx();
  uint8_t d[32];
  JsonDocument m;
  if (a.isChange) {
    hisn_digest_id(&c, HISN_CHANGE_VETO, a.id, d);
    m["t"] = "change_veto";
    m["changeId"] = a.id;
  } else {
    hisn_digest_id(&c, HISN_VETO, a.id, d);
    m["t"] = "veto";
    m["paymentId"] = a.id;
  }
  signInto(m, d);
  a.myStopSent = true;
  a.lastTry = millis();
  linkSend(m);
  Serial.printf("stop sent for %s %u\n", a.isChange ? "change" : "payment", (unsigned)a.id);
}

static void sendFreeze() {
  hisn_ctx c = ctx();
  uint8_t d[32];
  hisn_digest_id(&c, HISN_FREEZE, epoch, d);
  JsonDocument m;
  m["t"] = "freeze";
  m["epoch"] = epoch;
  signInto(m, d);
  linkSend(m);
  Serial.printf("freeze sent for epoch %u\n", (unsigned)epoch);
}

static void onMessage(JsonDocument &m) {
  const char *t = m["t"] | "";
  if (!strcmp(t, "alert")) {
    uint32_t id = m["paymentId"] | 0;
    bool fresh = find(false, id) == nullptr;
    Alarm *a = add(false, id);
    if (!a) return;
    a->approval = !strcmp(m["tier"] | "", "APPROVAL");
    a->releaseAt = m["releaseAt"] | 0ULL;
    if (fresh) sendAck(id);
  } else if (!strcmp(t, "change_alert")) {
    Alarm *a = add(true, m["changeId"] | 0);
    if (a) a->releaseAt = linkNow() + 3600;
  } else if (!strcmp(t, "clear") || !strcmp(t, "change_clear")) {
    bool isChange = !strcmp(t, "change_clear");
    Alarm *a = find(isChange, isChange ? (m["changeId"] | 0) : (m["paymentId"] | 0));
    if (!a) return;
    if (a->myStopSent) {
      a->used = false;
      okFlashUntil = millis() + 3000;
      tone(PIN_BUZZ, 1800, 900);
    } else {
      a->clearedElsewhere = true;
    }
  } else if (!strcmp(t, "result")) {
    const char *what = m["what"] | "";
    bool ok = m["ok"] | false;
    if (ok && (!strcmp(what, "veto") || !strcmp(what, "change_veto"))) {
      bool isChange = !strcmp(what, "change_veto");
      Alarm *a = find(isChange, isChange ? (m["changeId"] | 0) : (m["paymentId"] | 0));
      if (a) a->used = false;
      okFlashUntil = millis() + 3000;
      tone(PIN_BUZZ, 1800, 900);
      Serial.printf("stop confirmed for %s %u\n", isChange ? "change" : "payment", (unsigned)(isChange ? (m["changeId"] | 0) : (m["paymentId"] | 0)));
    }
  } else if (!strcmp(t, "error")) {
    const char *what = m["for"] | "";
    const char *reason = m["reason"] | "";
    Serial.printf("server error on %s: %s\n", what, reason);
    bool isChange = !strcmp(what, "change_veto");
    if ((isChange || !strcmp(what, "veto")) && (strstr(reason, "NotPending") || strstr(reason, "ChangeDead") || strstr(reason, "Expired"))) {
      Alarm *a = find(isChange, isChange ? (m["changeId"] | 0) : (m["paymentId"] | 0));
      if (a) a->used = false;
    }
  } else if (!strcmp(t, "state")) {
    epoch = m["epoch"] | epoch;
  }
}

static Mode mode() {
  if (linkState() != LINK_UP) return M_LOST;
  bool anyLive = false, approval = false, change = false, anyDim = false, sent = false;
  uint64_t now = linkNow();
  for (auto &a : alarms) {
    if (!a.used) continue;
    if (!a.isChange && a.releaseAt && now > a.releaseAt + 60) {
      a.used = false;
      continue;
    }
    if (a.myStopSent) sent = true;
    if (a.clearedElsewhere) {
      anyDim = true;
      continue;
    }
    anyLive = true;
    if (a.isChange) change = true;
    else if (a.approval) approval = true;
  }
  if (sent && pressing) return M_VETOING;
  if (anyLive) return change ? M_ALARM_CHANGE : approval ? M_ALARM_APPROVAL : M_ALARM_WAIT;
  if (sent) return M_VETOING;
  if (anyDim) return M_DIM;
  return M_CALM;
}

static uint64_t soonest() {
  uint64_t best = UINT64_MAX;
  for (auto &a : alarms)
    if (a.used && !a.isChange && !a.clearedElsewhere && a.releaseAt < best) best = a.releaseAt;
  return best;
}

static void lights(int red, int green) {
  analogWrite(PIN_RED, red);
  analogWrite(PIN_GREEN, green);
}

static void render() {
  uint32_t ms = millis();
  if (ms < okFlashUntil) {
    lights(0, 255);
    return;
  }
  Mode md = mode();
#ifdef HISN_SIM
  static const char *NAMES[] = {"CALM", "ALARM_WAIT", "ALARM_APPROVAL", "ALARM_CHANGE", "DIM", "VETOING", "LOST"};
  static int shown = -1;
  if (md != shown) {
    shown = md;
    Serial.printf("mode %s\n", NAMES[md]);
  }
#endif
  switch (md) {
    case M_CALM: {
      int v = (int)(40 + 40 * sin(ms / 900.0));
      lights(0, v);
      break;
    }
    case M_ALARM_WAIT: {
      uint64_t s = soonest();
      long left = s == UINT64_MAX ? 999 : (long)s - (long)linkNow();
      uint32_t period = left < 30 ? 250 : left < 90 ? 500 : 900;
      lights((ms / period) % 2 ? 255 : 0, 0);
      uint32_t every = left < 30 ? 1000 : 5000;
      if (ms - lastBeep > every) {
        lastBeep = ms;
        tone(PIN_BUZZ, 2800, 120);
      }
      break;
    }
    case M_ALARM_APPROVAL:
      lights((ms / 500) % 2 ? 255 : 0, (ms / 500) % 2 ? 0 : 255);
      if (ms - lastBeep > 10000) {
        lastBeep = ms;
        tone(PIN_BUZZ, 2800, 100);
        delay(160);
        tone(PIN_BUZZ, 2800, 100);
      }
      break;
    case M_ALARM_CHANGE:
      lights((ms / 1500) % 2 ? 255 : 60, 0);
      if (ms - lastBeep > 8000) {
        lastBeep = ms;
        tone(PIN_BUZZ, 1500, 400);
      }
      break;
    case M_DIM:
      lights(30, 0);
      break;
    case M_VETOING:
      lights(255, 0);
      break;
    case M_LOST:
      lights((ms / 1200) % 2 ? 120 : 0, (ms / 1200) % 2 ? 120 : 0);
      if (ms - lastBeep > 60000) {
        lastBeep = ms;
        tone(PIN_BUZZ, 1200, 150);
      }
      break;
  }
}

static void handleButton() {
  static bool armed = false;
  bool down = digitalRead(PIN_VETO) == LOW;
  uint32_t ms = millis();
  if (!armed) {
    if (!down) armed = true;
    return;
  }
  if (down && !pressing) {
    pressing = true;
    pressStart = ms;
    vetoFired = false;
    freezeFired = false;
  } else if (!down && pressing) {
    pressing = false;
    noTone(PIN_BUZZ);
  }
  if (!pressing) return;
  uint32_t held = ms - pressStart;
  if (held > 200 && !vetoFired) tone(PIN_BUZZ, 900);
  if (held > 2000 && !vetoFired) {
    vetoFired = true;
    int n = 0;
    for (auto &a : alarms)
      if (a.used && !a.clearedElsewhere) {
        sendStop(a);
        n++;
      }
    if (n == 0) Serial.println("nothing to stop; keep holding 5 s to freeze");
  }
  if (held > 5000 && !freezeFired) {
    freezeFired = true;
    sendFreeze();
  }
  static uint32_t quietedAt = 0;
  if (freezeFired && held > 6000 && quietedAt != pressStart) {
    quietedAt = pressStart;
    noTone(PIN_BUZZ);
  }
}

static void retryStops() {
  for (auto &a : alarms)
    if (a.used && a.myStopSent && millis() - a.lastTry > 3000) sendStop(a);
}

static bool extraCommand(int argc, String *argv) {
#ifdef HISN_SIM
  if (argv[0] == "simkey" && argc >= 2) {
    uint8_t k[32];
    if (argv[1].length() != 66 || hisn_hex(argv[1].c_str(), k, 32) != 0) {
      Serial.println("usage: simkey 0x<64 hex>");
      return true;
    }
    bool ok = keyImportPlain(k, myAddr);
    memset(k, 0, 32);
    if (ok) {
      keyLoadPlain(priv);
      myAddrStr = checksumAddress(myAddr);
      linkSetAddress(myAddrStr);
    }
    Serial.println(ok ? "simkey stored" : "simkey failed");
    return true;
  }
#endif
  if (argv[0] == "address") {
    Serial.println(myAddrStr);
    return true;
  }
  if (argv[0] == "resetkey" && argc >= 2 && argv[1] == "yes") {
    keyWipe();
    Serial.println("key erased; reboot");
    return true;
  }
  if (argv[0] == "importkey" && argc >= 2) {
    uint8_t k[32], a[20];
    if (!parseKey(argv[1].c_str(), k) || !keyImportPlain(k, a)) {
      Serial.println("bad key: 64 hex digits, with or without 0x");
    } else {
      Serial.printf("light key replaced: %s is now %s; reboot\n", myAddrStr.c_str(), checksumAddress(a).c_str());
    }
    memset(k, 0, sizeof(k));
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_GREEN, OUTPUT);
  pinMode(PIN_BUZZ, OUTPUT);
  pinMode(PIN_VETO, INPUT_PULLUP);
  WiFi.mode(WIFI_STA);
  settingsLoad(cfg);
  if (!keyExists()) keyCreatePlain(myAddr);
  keyAddress(myAddr);
  keyLoadPlain(priv);
  myAddrStr = checksumAddress(myAddr);
  consoleBegin(&cfg, extraCommand, myAddrStr);
  Serial.printf("light %s address %s\n", cfg.deviceId.c_str(), myAddrStr.c_str());
  if (!cfg.hasVault) Serial.println("vault not set: hisn> vault 0x...");
  linkBegin(&cfg, "guardian", myAddrStr, onMessage);
}

void loop() {
  consoleLoop();
  linkLoop();
  handleButton();
  retryStops();
  render();
  delay(5);
}
