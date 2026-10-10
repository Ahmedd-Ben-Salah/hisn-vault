#include "hisn_build.h"
#include "link.h"
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <time.h>

static WebSocketsClient ws;
static Settings *cfg = nullptr;
static MessageHandler handler = nullptr;
static String myRole, myAddress;
static bool wsUp = false;
static bool wsStarted = false;
static uint32_t lastWifiTry = 0;
static int wifiIndex = 0;
static bool ntpStarted = false;

static void onEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      wsUp = true;
      Serial.println("link: relayer connected");
      JsonDocument hello;
      hello["t"] = "hello";
      hello["address"] = myAddress;
      hello["fw"] = "0.1";
      linkSend(hello);
      break;
    }
    case WStype_DISCONNECTED:
      if (wsUp) Serial.println("link: relayer disconnected");
      wsUp = false;
      break;
    case WStype_ERROR:
      Serial.printf("link: websocket error %.*s\n", (int)length, (const char *)payload);
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;
      const char *t = doc["t"] | "";
      if (strcmp(t, "ping") == 0) {
        JsonDocument pong;
        pong["t"] = "pong";
        linkSend(pong);
        return;
      }
      if (handler) handler(doc);
      break;
    }
    default:
      break;
  }
}

void linkBegin(Settings *s, const char *role, const String &address, MessageHandler onMessage) {
  cfg = s;
  myRole = role;
  myAddress = address;
  handler = onMessage;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
}

static void tryWifi() {
  for (int i = 0; i < 2; i++) {
    int idx = (wifiIndex + i) % 2;
    if (cfg->ssid[idx].isEmpty()) continue;
    wifiIndex = (idx + 1) % 2;
    WiFi.disconnect();
    WiFi.begin(cfg->ssid[idx].c_str(), cfg->pass[idx].c_str());
    Serial.printf("wifi: trying %s\n", cfg->ssid[idx].c_str());
    return;
  }
}

static void startWs() {
  if (cfg->relayer.isEmpty()) return;
  String path = String("/device?id=") + cfg->deviceId + "&role=" + myRole;
  if (!cfg->token.isEmpty()) path += String("&token=") + cfg->token;
  if (cfg->port == 443) ws.beginSSL(cfg->relayer.c_str(), cfg->port, path.c_str());
  else ws.begin(cfg->relayer.c_str(), cfg->port, path.c_str());
  ws.onEvent(onEvent);
  ws.setReconnectInterval(3000);
  wsStarted = true;
}

static void report() {
  static int last = -1;
  static uint32_t lastTry = 0;
  int st = (int)linkState();
  if (st == last) {
    if (st == LINK_NO_RELAYER && millis() - lastTry > 30000) {
      lastTry = millis();
      Serial.printf("link: still no relayer at %s:%u\n", cfg->relayer.c_str(), cfg->port);
    }
    return;
  }
  last = st;
  lastTry = millis();
  if (st == LINK_NO_WIFI) Serial.println("link: no wifi");
  else if (st == LINK_NO_CLOCK) Serial.printf("link: wifi up %s, waiting for the clock\n", WiFi.localIP().toString().c_str());
  else if (st == LINK_NO_RELAYER) Serial.printf("link: clock ok, connecting to %s:%u\n", cfg->relayer.c_str(), cfg->port);
  else Serial.println("link: up");
}

void linkSetAddress(const String &address) {
  myAddress = address;
}

void linkLoop() {
  if (!cfg) return;
  report();
  if (WiFi.status() != WL_CONNECTED) {
    wsUp = false;
    if (millis() - lastWifiTry > 10000 || lastWifiTry == 0) {
      lastWifiTry = millis();
      tryWifi();
    }
    return;
  }
  if (!ntpStarted) {
    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
    ntpStarted = true;
  }
  if (!wsStarted) startWs();
  ws.loop();
}

bool linkClockOk() {
  return time(nullptr) > 1700000000;
}

uint64_t linkNow() {
  return (uint64_t)time(nullptr);
}

LinkState linkState() {
  if (WiFi.status() != WL_CONNECTED) return LINK_NO_WIFI;
  if (!linkClockOk()) return LINK_NO_CLOCK;
  if (!wsUp) return LINK_NO_RELAYER;
  return LINK_UP;
}

bool linkSend(JsonDocument &msg) {
  if (!wsUp) return false;
  String out;
  serializeJson(msg, out);
  return ws.sendTXT(out);
}

int linkWifiBars() {
  if (WiFi.status() != WL_CONNECTED) return 0;
  int rssi = WiFi.RSSI();
  if (rssi > -55) return 4;
  if (rssi > -65) return 3;
  if (rssi > -75) return 2;
  return 1;
}
