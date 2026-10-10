#include <Arduino.h>
#include <WiFi.h>
#include <U8g2lib.h>
#include <ArduinoJson.h>
#include "hisn.h"
#include "keccak.h"
#include "../common/settings.h"
#include "../common/pq_keys.h"
#include "../common/link.h"
#include "../common/keys.h"
#include "../common/console.h"
#include "../common/util.h"
#include "payees.h"

#ifndef PIN_UP
#define PIN_UP 32
#endif
#ifndef PIN_NEXT
#define PIN_NEXT 33
#endif
#ifndef PIN_OK
#define PIN_OK 25
#endif
#ifndef PIN_BUZZ
#define PIN_BUZZ 26
#endif

static U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
static Settings cfg;
static uint8_t myAddr[20];
static String myAddrStr;
static uint32_t epoch = 0;
static uint32_t keyEpoch = 0;
static bool frozen = false;

enum ItemKind { IT_PAY, IT_RECONFIRM, IT_CHANGE, IT_RECOVERY, IT_NAME, IT_STOPPED };

struct Item {
  ItemKind kind;
  uint32_t ref;
  uint8_t to[20];
  uint8_t token[20];
  hisn_word amount;
  uint8_t changeKind;
  hisn_word words[5];
  uint8_t nWords;
  uint32_t itemKeyEpoch;
  char label[17];
  bool stopOnly; // asked from the web page: the only action offered is Stop
  char text[4][22];
  uint32_t arrived;
};

static const int QUEUE_MAX = 4;
static Item queue[QUEUE_MAX];
static int queued = 0;

enum Screen { SC_SETUP, SC_OFFLINE, SC_IDLE, SC_REVIEW, SC_PIN, SC_BUSY, SC_RESULT, SC_MENU, SC_ADDRESS, SC_PAYEES };
static Screen screen = SC_IDLE;
static int page = 0;
static uint32_t screenAt = 0;
static String resultText[3];
static uint32_t resultUntil = 0;

enum PinPurpose { PP_CREATE, PP_CONFIRM, PP_SIGN, PP_CANCEL, PP_FREEZE };
static PinPurpose pinPurpose;
#ifndef HISN_PIN_LEN
#define HISN_PIN_LEN 3
#endif

static uint8_t pinDigits[HISN_PIN_LEN];
static int pinPos = 0;
static char firstPin[HISN_PIN_LEN + 1];
static int menuIndex = 0;
static int payeeIndex = 0;
static bool restartAfterAddress = false;
static uint8_t importKey[32];
static bool hasImport = false;

static void startPin(PinPurpose p);
static void draw();

struct Button {
  explicit Button(uint8_t p) : pin(p) {}
  uint8_t pin;
  bool down = false;
  uint32_t since = 0;
  bool held = false;
  uint32_t changed = 0;
};
static Button bUp(PIN_UP), bNext(PIN_NEXT), bOk(PIN_OK);

enum Event { EV_NONE, EV_PRESS, EV_HOLD };
static bool redraw = true;

static Event poll(Button &b) {
  bool d = digitalRead(b.pin) == LOW;
  uint32_t now = millis();
  if (d != b.down && now - b.changed > 30) {
    b.changed = now;
    b.down = d;
    if (d) {
      b.since = now;
      b.held = false;
    } else if (!b.held) {
      redraw = true;
      return EV_PRESS;
    }
  }
  if (b.down && !b.held && now - b.since > 1500) {
    b.held = true;
    redraw = true;
    return EV_HOLD;
  }
  return EV_NONE;
}

static void beep(int ms) {
  tone(PIN_BUZZ, 2400, ms);
}

static void go(Screen s) {
#ifdef HISN_SIM
  static const char *const NAMES[] = {"SETUP", "OFFLINE", "IDLE", "REVIEW", "PIN", "BUSY", "RESULT", "MENU", "ADDRESS", "PAYEES"};
  if (s != screen) Serial.printf("screen %s\n", NAMES[s]);
#endif
  screen = s;
  screenAt = millis();
  redraw = true;
  page = 0;
}

static void showResult(const String &a, const String &b = "", const String &c = "", uint32_t ms = 5000) {
  resultText[0] = a;
  resultText[1] = b;
  resultText[2] = c;
  resultUntil = millis() + ms;
#ifdef HISN_SIM
  Serial.printf("result %s | %s | %s\n", a.c_str(), b.c_str(), c.c_str());
#endif
  go(SC_RESULT);
}

static Item *current() {
  return queued ? &queue[0] : nullptr;
}

static void popItem() {
  if (!queued) return;
  for (int i = 1; i < queued; i++) queue[i - 1] = queue[i];
  queued--;
  go(queued ? SC_REVIEW : SC_IDLE);
}

static bool pushItem(const Item &it) {
  if (queued >= QUEUE_MAX) return false;
  queue[queued++] = it;
  queue[queued - 1].arrived = millis();
  if (queued == 1 && (screen == SC_IDLE || screen == SC_RESULT || screen == SC_MENU || screen == SC_ADDRESS || screen == SC_PAYEES)) {
    go(SC_REVIEW);
    beep(120);
  }
  return true;
}

static void sendRejected(uint32_t reqId, bool change) {
  JsonDocument m;
  m["t"] = "rejected";
  m["reqId"] = reqId;
  if (change) m["change"] = true;
  linkSend(m);
}

static String nameFor(const uint8_t a[20]) {
  const Payee *p = payeeFind(a, true);
  return p ? String(p->label) : String("");
}

static const char *KIND_NAMES[] = {"ADD PAYEE", "REMOVE PAYEE", "SET LIMITS", "SET COOL-OFF", "SET AGENT", "ADD GUARDIAN",
                                   "REMOVE GUARDIAN", "ADD WATCHER", "REMOVE WATCHER", "UNFREEZE", "RECOVER PUCK"};

static bool describeChange(Item &it, const uint8_t *data, size_t len) {
  uint8_t k = it.changeKind;
  size_t want = k == 9 ? 0 : k == 2 ? 5 : 1;
  if (k > 9 || len != want * 32) return false;
  it.nWords = (uint8_t)want;
  for (size_t i = 0; i < want; i++) memcpy(it.words[i], data + 32 * i, 32);
  snprintf(it.text[0], 22, "%s", KIND_NAMES[k]);
  it.text[1][0] = it.text[2][0] = it.text[3][0] = 0;
  if (k == 9) {
    snprintf(it.text[1], 22, "UNFREEZE ACCOUNT");
  } else if (k == 3) {
    char s[40];
    hisn_word_to_dec(it.words[0], s, sizeof(s));
    strlcpy(it.text[1], (String("COOL-OFF ") + s + " s").c_str(), 22);
  } else if (k == 2) {
    uint8_t token[20];
    memcpy(token, it.words[0] + 12, 20);
    const TokenInfo *t = tokenFind(token);
    if (!t) return false;
    strlcpy(it.text[1], (String(t->symbol) + " instant " + formatToken(it.words[1], t)).c_str(), 22);
    strlcpy(it.text[2], ("wait max " + formatToken(it.words[2], t)).c_str(), 22);
    strlcpy(it.text[3], ("day cap " + formatToken(it.words[3], t)).c_str(), 22);
  } else {
    uint8_t a[20];
    memcpy(a, it.words[0] + 12, 20);
    snprintf(it.text[1], 22, "%s", shortAddress(a).c_str());
    if (it.label[0]) strlcpy(it.text[2], (String("name: ") + it.label).c_str(), 22);
  }
  return true;
}

static void onMessage(JsonDocument &m) {
  const char *t = m["t"] | "";
  if (!strcmp(t, "request")) {
    Item it{};
    it.kind = IT_PAY;
    it.ref = m["reqId"] | 0;
    bool ok = parseAddress(m["to"] | "", it.to) && parseAddress(m["token"] | "", it.token) && hisn_word_dec(it.amount, m["amount"] | "") == 0;
    if (!ok || !tokenFind(it.token)) {
      sendRejected(it.ref, false);
      showResult("UNKNOWN TOKEN", "or bad request", "refused");
      return;
    }
    if (!pushItem(it)) sendRejected(it.ref, false);
  } else if (!strcmp(t, "reconfirm")) {
    uint32_t id = m["paymentId"] | 0;
    for (int i = 0; i < queued; i++)
      if (queue[i].kind == IT_RECONFIRM && queue[i].ref == id) return;
    Item it{};
    it.kind = IT_RECONFIRM;
    it.ref = id;
    if (!parseAddress(m["to"] | "", it.to) || !parseAddress(m["token"] | "", it.token) || hisn_word_dec(it.amount, m["amount"] | "") != 0) return;
    if (!tokenFind(it.token)) return;
    pushItem(it);
  } else if (!strcmp(t, "cancel_request")) {
    uint32_t id = m["paymentId"] | 0;
    for (int i = 0; i < queued; i++)
      if (queue[i].kind == IT_RECONFIRM && queue[i].ref == id) {
        queue[i].stopOnly = true;
        return;
      }
    Item it{};
    it.kind = IT_RECONFIRM;
    it.stopOnly = true;
    it.ref = id;
    if (!parseAddress(m["to"] | "", it.to) || !parseAddress(m["token"] | "", it.token) || hisn_word_dec(it.amount, m["amount"] | "") != 0) return;
    if (!tokenFind(it.token)) return;
    pushItem(it);
    beep(150);
  } else if (!strcmp(t, "freeze_request")) {
    if (screen == SC_IDLE || screen == SC_REVIEW) startPin(PP_FREEZE);
  } else if (!strcmp(t, "change")) {
    Item it{};
    it.kind = IT_CHANGE;
    it.ref = m["reqId"] | 0;
    it.changeKind = m["kind"] | 255;
    it.itemKeyEpoch = m["keyEpoch"] | 0;
    strncpy(it.label, m["label"] | "", 16);
    const char *dataHex = m["data"] | "0x";
    size_t hexLen = strlen(dataHex) > 2 ? strlen(dataHex) - 2 : 0;
    uint8_t data[160];
    bool ok = hexLen % 64 == 0 && hexLen / 2 <= sizeof(data) && (hexLen == 0 || hisn_hex(dataHex, data, hexLen / 2) == 0);
    if (!ok || !describeChange(it, data, hexLen / 2)) {
      sendRejected(it.ref, true);
      showResult("CHANGE REFUSED", "cannot decode it", "on this puck");
      return;
    }
    if (!pushItem(it)) sendRejected(it.ref, true);
  } else if (!strcmp(t, "recovery_alert")) {
    Item it{};
    it.kind = IT_RECOVERY;
    it.ref = m["changeId"] | 0;
    parseAddress(m["newPuck"] | "", it.to);
    pushItem(it);
    for (int i = 0; i < 3; i++) {
      beep(300);
      delay(400);
    }
  } else if (!strcmp(t, "change_applied")) {
    int kind = m["kind"] | -1;
    uint8_t a[20];
    if (kind == 0 && parseAddress(m["fields"]["address"] | "", a)) {
      const Payee *p = payeeFind(a, false);
      if (p && !p->active) {
        Item it{};
        it.kind = IT_NAME;
        memcpy(it.to, a, 20);
        strncpy(it.label, p->label, 16);
        pushItem(it);
      }
    } else if (kind == 1 && parseAddress(m["fields"]["address"] | "", a)) {
      payeeRemove(a);
    }
  } else if (!strcmp(t, "stopped")) {
    const char *why = m["why"] | "";
    if (!strcmp(why, "VETOED")) {
      Item it{};
      it.kind = IT_STOPPED;
      it.ref = m["paymentId"] | 0;
      pushItem(it);
    }
  } else if (!strcmp(t, "result")) {
    bool ok = m["ok"] | false;
    const char *what = m["what"] | "payment";
    if (!ok) {
      showResult("NOT SENT", String(m["error"] | "error").substring(0, 21), "nothing moved");
      return;
    }
    if (!strcmp(what, "payment")) {
      const char *tier = m["tier"] | "";
      uint32_t id = m["paymentId"] | 0;
      if (!strcmp(tier, "INSTANT")) {
        showResult("PAID", String("payment #") + id, "");
      } else {
        uint64_t rel = m["releaseAt"] | 0ULL;
        long secs = rel > linkNow() ? (long)(rel - linkNow()) : 0;
        showResult(String("WAITING #") + id, String(tier) + " " + (secs / 60) + "m" + (secs % 60) + "s", !strcmp(tier, "WAIT") ? "confirm again later" : "guardian must agree");
      }
    } else if (!strcmp(what, "reconfirm")) {
      showResult("CONFIRMED", "the network releases", "it at the set time");
    } else if (!strcmp(what, "cancel")) {
      showResult("CANCELLED", String("payment #") + (uint32_t)(m["paymentId"] | 0), "nothing will move");
    } else {
      showResult("DONE", what, "");
    }
  } else if (!strcmp(t, "state")) {
    epoch = m["epoch"] | epoch;
    keyEpoch = m["keyEpoch"] | keyEpoch;
    frozen = m["frozen"] | false;
    uint8_t theirs[32], mine[32];
    uint32_t used = m["pqUsed"] | 0;
    const char *root = m["pqRoot"] | "";
    if (used && strlen(root) == 66 && hisn_hex(root, theirs, 32) == 0 && pqStoredRoot(mine) && memcmp(theirs, mine, 32) == 0 && pqSkipTo(used))
      Serial.printf("pq: the vault has used %u one-time keys, next is %u\n", (unsigned)used, (unsigned)pqNext());
  } else if (!strcmp(t, "error")) {
    const char *forWhat = m["for"] | "";
    String reason = String(m["reason"] | "").substring(0, 21);
    if (!strcmp(forWhat, "reconfirmed")) showResult("NOT CONFIRMED", reason, "nothing moved");
    else if (!strcmp(forWhat, "cancel")) showResult("NOT CANCELLED", reason, "");
    else showResult("SERVER ERROR", reason, forWhat);
  }
}

static bool currentPin(char out[HISN_PIN_LEN + 1]) {
  for (int i = 0; i < HISN_PIN_LEN; i++) out[i] = (char)('0' + pinDigits[i]);
  out[HISN_PIN_LEN] = 0;
  return true;
}

static void startPin(PinPurpose p) {
  pinPurpose = p;
#ifdef HISN_SIM
  for (int i = 0; i < HISN_PIN_LEN; i++) pinDigits[i] = 0;
#else
  for (int i = 0; i < HISN_PIN_LEN; i++) pinDigits[i] = (uint8_t)(esp_random() % 10);
#endif
  pinPos = 0;
  go(SC_PIN);
}

static String nonceHex(uint64_t n) {
  char b[19];
  snprintf(b, sizeof(b), "0x%llx", (unsigned long long)n);
  return String(b);
}

static bool pqOutOfKeys = false;

// Adds the hash-based (post-quantum) signature over the same digest. The vault needs both when it has a PQ root.
static void addPq(JsonDocument &m, const uint8_t digest[32], const uint8_t priv[32]) {
  String pq = pqSignHex(priv, cfg.chainId, cfg.vault, digest);
  if (pq.length()) {
    m["pq"] = pq;
  } else {
    pqOutOfKeys = true;
  }
}

static void sendSig(JsonDocument &m, const uint8_t digest[32], const uint8_t priv[32]) {
  uint8_t w[32], r[32], s[32];
  hisn_eip191(digest, w);
  hisn_sign(priv, w, r, s);
  m["r"] = hexString(r, 32);
  m["s"] = hexString(s, 32);
  memset(r, 0, 32);
  memset(s, 0, 32);
  linkSend(m);
}

static void signCurrent(const uint8_t priv[32], bool cancelInstead) {
  Item *it = current();
  hisn_ctx ctx;
  memcpy(ctx.vault, cfg.vault, 20);
  ctx.chain_id = cfg.chainId;
  uint8_t d[32];
  uint64_t nonce = randomU64();
  uint64_t deadline = linkNow() + 120;
  JsonDocument m;
  if (!it) {
    if (pinPurpose == PP_FREEZE) {
      hisn_digest_id(&ctx, HISN_FREEZE, epoch, d);
      m["t"] = "freeze";
      m["epoch"] = epoch;
      sendSig(m, d, priv);
      showResult("FREEZE SENT", "all waiting payments", "will be cancelled");
    }
    return;
  }
  switch (it->kind) {
    case IT_PAY:
      hisn_digest_pay(&ctx, HISN_PAY, it->to, it->token, it->amount, nonce, deadline, d);
      m["t"] = "signed";
      m["reqId"] = it->ref;
      m["nonce"] = nonceHex(nonce);
      m["deadline"] = deadline;
      addPq(m, d, priv);
      sendSig(m, d, priv);
      popItem();
      showResult("SIGNED", "sending to the", "network...", 15000);
      return;
    case IT_RECONFIRM:
      if (cancelInstead || it->stopOnly) {
        hisn_digest_id(&ctx, HISN_CANCEL, it->ref, d);
        m["t"] = "cancel";
        m["paymentId"] = it->ref;
        sendSig(m, d, priv);
        popItem();
        showResult("SENDING", "cancel for", String("payment #") + it->ref, 15000);
      } else {
        hisn_digest_reconfirm(&ctx, it->ref, nonce, deadline, d);
        m["t"] = "reconfirmed";
        m["paymentId"] = it->ref;
        m["nonce"] = nonceHex(nonce);
        m["deadline"] = deadline;
        addPq(m, d, priv);
        sendSig(m, d, priv);
        popItem();
        showResult("SENDING", "second yes for", String("payment #") + it->ref, 15000);
      }
      return;
    case IT_CHANGE:
      hisn_digest_change(&ctx, it->changeKind, it->itemKeyEpoch, (const hisn_word *)it->words, it->nWords, nonce, deadline, d);
      m["t"] = "change_signed";
      m["reqId"] = it->ref;
      m["nonce"] = nonceHex(nonce);
      m["deadline"] = deadline;
      addPq(m, d, priv);
      sendSig(m, d, priv);
      if (it->changeKind == 0 && it->label[0]) {
        uint8_t a[20];
        memcpy(a, it->words[0] + 12, 20);
        payeePut(a, it->label, false);
      }
      popItem();
      showResult("CHANGE SIGNED", "it waits before", "it applies");
      return;
    case IT_RECOVERY:
      hisn_digest_id(&ctx, HISN_CHANGE_VETO, it->ref, d);
      m["t"] = "change_veto";
      m["changeId"] = it->ref;
      sendSig(m, d, priv);
      popItem();
      showResult("RECOVERY STOPPED", "this puck stays", "in charge");
      return;
    default:
      return;
  }
}

static void pinDone() {
  char pin[HISN_PIN_LEN + 1];
  currentPin(pin);
  if (pinPurpose == PP_CREATE) {
    memcpy(firstPin, pin, sizeof(firstPin));
    startPin(PP_CONFIRM);
    return;
  }
  if (pinPurpose == PP_CONFIRM) {
    if (strcmp(firstPin, pin) != 0) {
      memset(firstPin, 0, sizeof(firstPin));
      showResult("PINS DIFFER", "try again", "", 2500);
      startPin(PP_CREATE);
      return;
    }
    go(SC_BUSY);
    bool made = keyCreateWithPin(pin, myAddr, hasImport ? importKey : nullptr);
    memset(importKey, 0, sizeof(importKey));
    hasImport = false;
    if (made) {
      myAddrStr = checksumAddress(myAddr);
      Serial.printf("puck address %s\n", myAddrStr.c_str());
      uint8_t priv[32], root[32];
      showResult("PREPARING", "quantum-safe keys", "about 20 seconds", 30000);
      draw();
      if (keyUnlock(pin, priv) == UNLOCK_OK && pqPrepare(priv) && pqStoredRoot(root)) {
        Serial.printf("pq root %s (%u one-time keys)\n", hexString(root, 32).c_str(), (unsigned)pqLeft());
      }
      memset(priv, 0, 32);
      restartAfterAddress = true;
      go(SC_ADDRESS);
    }
    memset(firstPin, 0, sizeof(firstPin));
    memset(pin, 0, sizeof(pin));
    return;
  }
  if (!linkClockOk()) {
    showResult("NO CLOCK", "cannot sign", "check Wi-Fi");
    return;
  }
  go(SC_BUSY);
  uint8_t priv[32];
  UnlockResult r = keyUnlock(pin, priv);
  memset(pin, 0, sizeof(pin));
  if (r == UNLOCK_OK) {
    if (!pqReady()) {
      showResult("PREPARING", "quantum-safe keys", "once after start", 30000);
      draw();
    }
    signCurrent(priv, pinPurpose == PP_CANCEL);
    memset(priv, 0, 32);
    if (pqOutOfKeys) {
      pqOutOfKeys = false;
      showResult("NO QUANTUM KEYS", "LEFT. Install new", "keys (settings)", 15000);
    }
  } else if (r == UNLOCK_WIPED) {
    showResult("KEY ERASED", "10 wrong PINs", "use recovery", 60000);
  } else {
    showResult("WRONG PIN", String(10 - keyFailures()) + " tries left", "", 3000);
    if (queued) {
      resultUntil = millis() + 2500;
    }
  }
}

static void drawHeader(const char *title) {
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 9, title);
  int bars = linkWifiBars();
  for (int i = 0; i < 4; i++) {
    int h = 2 + 2 * i;
    if (i < bars) oled.drawBox(108 + 5 * i, 9 - h, 3, h);
    else oled.drawFrame(108 + 5 * i, 9 - h, 3, h);
  }
}

static void drawReview(Item *it) {
  oled.setFont(u8g2_font_6x10_tf);
  const TokenInfo *t = tokenFind(it->token);
  switch (it->kind) {
    case IT_PAY:
    case IT_RECONFIRM: {
      String name = nameFor(it->to);
      if (page == 0) {
        if (it->stopOnly) oled.drawStr(0, 9, "STOP THIS PAYMENT?");
        else if (it->kind == IT_RECONFIRM) oled.drawStr(0, 9, "STILL SEND?");
        else oled.drawStr(0, 9, name.length() ? name.c_str() : "!! NEW RECIPIENT !!");
        oled.setFont(u8g2_font_9x15B_tf);
        oled.drawStr(0, 26, formatToken(it->amount, t).c_str());
        oled.setFont(u8g2_font_6x10_tf);
        oled.drawStr(0, 37, shortAddress(it->to).c_str());
        if (it->kind == IT_RECONFIRM) {
          oled.drawStr(0, 47, name.length() ? name.c_str() : "NEW RECIPIENT");
          oled.drawStr(0, 56, "SECRET? PRESS NO");
        } else if (name.length()) {
          oled.drawStr(0, 50, "saved payee");
        } else {
          oled.drawStr(0, 47, "HISN NEVER ASKS YOU");
          oled.drawStr(0, 56, "TO MOVE MONEY");
        }
        oled.drawStr(0, 64, it->stopOnly ? "LATER   MORE     STOP" : "NO      MORE      YES");
      } else {
        String a = checksumAddress(it->to);
        oled.drawStr(0, 9, "FULL ADDRESS");
        for (int i = 0; i < 3; i++) oled.drawStr(0, 21 + 11 * i, a.substring(i * 14, i * 14 + 14).c_str());
        oled.drawStr(0, 64, "NO      BACK      YES");
      }
      return;
    }
    case IT_CHANGE:
      oled.drawStr(0, 9, "SETTINGS CHANGE");
      for (int i = 0; i < 4; i++) oled.drawStr(0, 21 + 10 * i, it->text[i]);
      oled.drawStr(0, 64, "NO                YES");
      return;
    case IT_RECOVERY:
      oled.drawStr(0, 9, "!! WARNING !!");
      oled.drawStr(0, 21, "SOMEONE IS REPLACING");
      oled.drawStr(0, 31, "THIS PUCK");
      oled.drawStr(0, 43, "CANCEL IT?");
      oled.drawStr(0, 64, "LATER        CANCEL IT");
      return;
    case IT_NAME:
      oled.drawStr(0, 9, "SAVE NAME?");
      oled.drawStr(0, 23, it->label);
      oled.drawStr(0, 35, "for");
      oled.drawStr(0, 47, shortAddress(it->to).c_str());
      oled.drawStr(0, 64, "NO                YES");
      return;
    case IT_STOPPED:
      oled.drawStr(0, 9, "STOPPED BY GUARDIAN");
      oled.drawStr(0, 23, String(String("payment #") + it->ref).c_str());
      oled.drawStr(0, 37, "NOBODY CAN RECOVER");
      oled.drawStr(0, 47, "MONEY FOR A FEE");
      oled.drawStr(0, 64, "                   OK");
      return;
  }
}

static void draw() {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  switch (screen) {
    case SC_SETUP:
      oled.drawStr(0, 12, hasImport ? "IMPORTED KEY" : "NEW PUCK");
      oled.drawStr(0, 28, (String("Choose a ") + HISN_PIN_LEN + "-digit PIN").c_str());
      oled.drawStr(0, 64, "                   OK");
      break;
    case SC_OFFLINE: {
      drawHeader("HISN");
      LinkState s = linkState();
      oled.drawStr(0, 30, s == LINK_NO_WIFI ? "OFFLINE: no Wi-Fi" : s == LINK_NO_CLOCK ? "NO CLOCK yet" : "NO SERVER");
      oled.drawStr(0, 44, "nothing can be signed");
      oled.drawStr(0, 54, "nothing is at risk");
      break;
    }
    case SC_IDLE:
      drawHeader("HISN");
      oled.setFont(u8g2_font_9x15B_tf);
      oled.drawStr(0, 32, frozen ? "FROZEN" : "ready");
      oled.setFont(u8g2_font_6x10_tf);
      oled.drawStr(0, 48, shortAddress(myAddr).c_str());
      oled.drawStr(0, 64, "hold MORE for menu");
      break;
    case SC_REVIEW:
      if (current()) drawReview(current());
      break;
    case SC_PIN: {
      const char *title = pinPurpose == PP_CREATE ? "NEW PIN" : pinPurpose == PP_CONFIRM ? "REPEAT PIN" : pinPurpose == PP_CANCEL ? "PIN TO CANCEL" : pinPurpose == PP_FREEZE ? "PIN TO FREEZE" : "PIN TO SIGN";
      oled.drawStr(0, 9, title);
      oled.setFont(u8g2_font_9x15B_tf);
      const int x0 = (128 - 19 * HISN_PIN_LEN) / 2;
      for (int i = 0; i < HISN_PIN_LEN; i++) {
        char c[2] = {i == pinPos ? (char)('0' + pinDigits[i]) : (i < pinPos ? '*' : '_'), 0};
        oled.drawStr(x0 + 2 + 19 * i, 38, c);
        if (i == pinPos) oled.drawHLine(x0 + 19 * i, 41, 12);
      }
      oled.setFont(u8g2_font_6x10_tf);
      oled.drawStr(0, 64, "+1     NEXT     DONE");
      break;
    }
    case SC_BUSY:
      oled.drawStr(0, 30, "working...");
      break;
    case SC_RESULT:
      oled.setFont(u8g2_font_9x15B_tf);
      oled.drawStr(0, 16, resultText[0].c_str());
      oled.setFont(u8g2_font_6x10_tf);
      oled.drawStr(0, 36, resultText[1].c_str());
      oled.drawStr(0, 48, resultText[2].c_str());
      break;
    case SC_MENU: {
      static const char *items[] = {"Freeze account", "Show my address", "Saved names", "Back"};
      oled.drawStr(0, 9, "MENU");
      for (int i = 0; i < 4; i++) {
        if (i == menuIndex) oled.drawStr(0, 22 + 11 * i, ">");
        oled.drawStr(10, 22 + 11 * i, items[i]);
      }
      break;
    }
    case SC_ADDRESS:
      oled.drawStr(0, 9, "PUCK ADDRESS");
      for (int i = 0; i < 3; i++) oled.drawStr(0, 21 + 11 * i, myAddrStr.substring(i * 14, i * 14 + 14).c_str());
      oled.drawStr(0, 64, "                   OK");
      break;
    case SC_PAYEES: {
      oled.drawStr(0, 9, "SAVED NAMES");
      const Payee *p = payeeAt(payeeIndex);
      if (!p) {
        oled.drawStr(0, 30, "none yet");
      } else {
        oled.drawStr(0, 26, p->label);
        oled.drawStr(0, 38, shortAddress(p->address).c_str());
        oled.drawStr(0, 50, p->active ? "active" : "waiting for chain");
      }
      oled.drawStr(0, 64, "      NEXT        OK");
      break;
    }
  }
  oled.sendBuffer();
}

static void handleButtons() {
  Event up = poll(bUp), next = poll(bNext), ok = poll(bOk);
  if (cfg.swapButtons) std::swap(up, ok);
  Item *it = current();
  switch (screen) {
    case SC_SETUP:
      if (ok == EV_PRESS) startPin(PP_CREATE);
      break;
    case SC_IDLE:
      if (next == EV_HOLD) {
        menuIndex = 0;
        go(SC_MENU);
      }
      break;
    case SC_REVIEW:
      if (!it) {
        go(SC_IDLE);
        break;
      }
      if (it->kind == IT_STOPPED) {
        if (ok == EV_PRESS) popItem();
        break;
      }
      if (it->kind == IT_NAME) {
        if (ok == EV_PRESS) payeeActivate(it->to);
        if (ok == EV_PRESS || up == EV_PRESS) popItem();
        break;
      }
      if (next == EV_PRESS && (it->kind == IT_PAY || it->kind == IT_RECONFIRM)) page = 1 - page;
      if (it->stopOnly) {
        if (ok == EV_PRESS) startPin(PP_CANCEL);
        if (up == EV_PRESS) popItem();
        break;
      }
      if (ok == EV_PRESS) startPin(PP_SIGN);
      if (up == EV_PRESS) {
        if (it->kind == IT_PAY) {
          sendRejected(it->ref, false);
          popItem();
          showResult("REFUSED", "nothing was signed", "");
        } else if (it->kind == IT_CHANGE) {
          sendRejected(it->ref, true);
          popItem();
          showResult("REFUSED", "nothing was signed", "");
        } else if (it->kind == IT_RECONFIRM) {
          startPin(PP_CANCEL);
        } else {
          popItem();
        }
      }
      if (it->kind == IT_PAY && millis() - it->arrived > 60000 && screen == SC_REVIEW) {
        sendRejected(it->ref, false);
        popItem();
      }
      break;
    case SC_PIN:
      if (up == EV_PRESS) pinDigits[pinPos] = (uint8_t)((pinDigits[pinPos] + 1) % 10);
      if (next == EV_PRESS) pinPos = (pinPos + 1) % HISN_PIN_LEN;
      if (ok == EV_PRESS) {
        if (pinPos < HISN_PIN_LEN - 1) pinPos++;
        else pinDone();
      }
      if (ok == EV_HOLD || (up == EV_HOLD && pinPurpose != PP_CREATE && pinPurpose != PP_CONFIRM))
        go(pinPurpose == PP_CREATE || pinPurpose == PP_CONFIRM ? SC_SETUP : queued ? SC_REVIEW : SC_IDLE);
      break;
    case SC_RESULT:
      if (ok == EV_PRESS || millis() > resultUntil) go(queued ? SC_REVIEW : SC_IDLE);
      break;
    case SC_MENU:
      if (next == EV_PRESS) menuIndex = (menuIndex + 1) % 4;
      if (up == EV_PRESS) menuIndex = (menuIndex + 3) % 4;
      if (ok == EV_PRESS) {
        if (menuIndex == 0) startPin(PP_FREEZE);
        else if (menuIndex == 1) go(SC_ADDRESS);
        else if (menuIndex == 2) {
          payeeIndex = 0;
          go(SC_PAYEES);
        } else go(SC_IDLE);
      }
      break;
    case SC_ADDRESS:
      if (ok == EV_PRESS) {
        if (restartAfterAddress) ESP.restart();
        go(queued ? SC_REVIEW : SC_IDLE);
      }
      break;
    case SC_PAYEES:
      if (next == EV_PRESS && payeeCount()) payeeIndex = (payeeIndex + 1) % payeeCount();
      if (ok == EV_PRESS) go(SC_IDLE);
      break;
    default:
      break;
  }
}

static bool extraCommand(int argc, String *argv) {
#ifdef HISN_SIM
  if (argv[0] == "simkey" && argc >= 3) {
    uint8_t k[32];
    if (argv[1].length() != 66 || hisn_hex(argv[1].c_str(), k, 32) != 0 || argv[2].length() != HISN_PIN_LEN) {
      Serial.printf("usage: simkey 0x<64 hex> <%d-digit pin>\n", HISN_PIN_LEN);
      return true;
    }
    bool ok = keyImportWithPin(k, argv[2].c_str(), myAddr);
    memset(k, 0, 32);
    if (ok) {
      myAddrStr = checksumAddress(myAddr);
      linkSetAddress(myAddrStr);
      go(SC_IDLE);
    }
    Serial.println(ok ? "simkey stored" : "simkey failed");
    return true;
  }
#endif
  if (argv[0] == "pin" && argc >= 3) {
    if (argv[2].length() != HISN_PIN_LEN || argv[2].length() != strspn(argv[2].c_str(), "0123456789")) {
      Serial.printf("usage: pin <current pin> <new %d-digit pin>\n", HISN_PIN_LEN);
      return true;
    }
    int r = keyChangePin(argv[1].c_str(), argv[2].c_str());
    Serial.println(r == UNLOCK_OK ? "pin changed" : r == UNLOCK_WIPED ? "key erased: too many wrong pins" : r == UNLOCK_NO_KEY ? "no key" : "wrong pin");
    return true;
  }
  if (argv[0] == "payee" && argc >= 2) {
    uint8_t a[20];
    if (argv[1] == "list") {
      for (int i = 0; i < payeeCount(); i++) {
        const Payee *p = payeeAt(i);
        Serial.printf("%s %s %s\n", checksumAddress(p->address).c_str(), p->label, p->active ? "active" : "inactive");
      }
      return true;
    }
    if (argv[1] == "add" && argc >= 4 && parseAddress(argv[2].c_str(), a)) {
      Serial.println(payeePut(a, argv[3].c_str(), true) ? "saved" : "list full");
      return true;
    }
    if (argv[1] == "del" && argc >= 3 && parseAddress(argv[2].c_str(), a)) {
      Serial.println(payeeRemove(a) ? "removed" : "not found");
      return true;
    }
  }
  if (argv[0] == "address") {
    Serial.println(myAddrStr);
    return true;
  }
  if (argv[0] == "pq") {
    uint8_t root[32];
    if (!pqStoredRoot(root)) {
      Serial.println("no hash-based keys yet: create the PIN first");
      return true;
    }
    if (argc >= 3 && argv[1] == "next") {
      uint32_t n = (uint32_t)argv[2].toInt();
      Serial.println(pqSkipTo(n) ? "saved" : "refused: one-time keys are never reused, the next index can only go up");
    }
    Serial.printf("pq root %s, height %d, next key %u, %u one-time keys left\n", hexString(root, 32).c_str(), HISN_PQ_HEIGHT, (unsigned)pqNext(), (unsigned)pqLeft());
    return true;
  }
  if (argv[0] == "importkey" && argc >= 2) {
    uint8_t a[20];
    if (keyExists()) {
      Serial.println("this puck already has a key: 'resetkey yes', reboot, then importkey");
    } else if (!parseKey(argv[1].c_str(), importKey) || hisn_address(importKey, a) != 0) {
      memset(importKey, 0, sizeof(importKey));
      Serial.println("bad key: 64 hex digits, with or without 0x");
    } else {
      hasImport = true;
      Serial.printf("key for %s loaded; press YES on the puck and choose the PIN\n", checksumAddress(a).c_str());
      go(SC_SETUP);
    }
    return true;
  }
  if (argv[0] == "resetkey" && argc >= 2 && argv[1] == "yes") {
    keyWipe();
    Serial.println("key erased; reboot");
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_UP, INPUT_PULLUP);
  pinMode(PIN_NEXT, INPUT_PULLUP);
  pinMode(PIN_OK, INPUT_PULLUP);
  pinMode(PIN_BUZZ, OUTPUT);
  oled.setBusClock(400000);
  oled.begin();
  WiFi.mode(WIFI_STA);
  settingsLoad(cfg);
  payeesLoad();
  if (keyExists() && keyAddress(myAddr)) {
    myAddrStr = checksumAddress(myAddr);
    go(SC_IDLE);
  } else {
    go(SC_SETUP);
  }
  consoleBegin(&cfg, extraCommand, myAddrStr);
  Serial.printf("puck %s address %s\n", cfg.deviceId.c_str(), myAddrStr.length() ? myAddrStr.c_str() : "(no key yet)");
  if (!cfg.hasVault) Serial.println("vault not set: hisn> vault 0x...");
  linkBegin(&cfg, "puck", myAddrStr, onMessage);
}

void loop() {
  consoleLoop();
  linkLoop();
  bool up = linkState() == LINK_UP;
  if (screen == SC_IDLE && !up) go(SC_OFFLINE);
  if (screen == SC_OFFLINE && up) go(queued ? SC_REVIEW : SC_IDLE);
  handleButtons();
  static uint32_t lastDraw = 0;
  if (redraw || millis() - lastDraw > 200) {
    redraw = false;
    lastDraw = millis();
    draw();
  }
}
