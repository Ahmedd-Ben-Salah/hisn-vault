#include "console.h"
#include "hisn.h"

static Settings *cfg = nullptr;
static ExtraCommand extraCmd = nullptr;
static String line;
static String addr;

static int tokenize(const String &in, String *out, int max) {
  int n = 0;
  int i = 0;
  int len = in.length();
  while (i < len && n < max) {
    while (i < len && in[i] == ' ') i++;
    if (i >= len) break;
    String tok;
    if (in[i] == '"') {
      i++;
      while (i < len && in[i] != '"') tok += in[i++];
      i++;
    } else {
      while (i < len && in[i] != ' ') tok += in[i++];
    }
    out[n++] = tok;
  }
  return n;
}

static void show() {
  Serial.printf("device   %s\n", cfg->deviceId.c_str());
  Serial.printf("address  %s\n", addr.c_str());
  Serial.printf("wifi 0   %s\n", cfg->ssid[0].c_str());
  Serial.printf("wifi 1   %s\n", cfg->ssid[1].c_str());
  Serial.printf("relayer  %s:%u%s\n", cfg->relayer.c_str(), cfg->port, cfg->port == 443 ? " (tls)" : "");
  Serial.printf("token    %s\n", cfg->token.isEmpty() ? "(none)" : "set");
  char v[43];
  hisn_to_hex(cfg->vault, 20, v);
  Serial.printf("vault    %s\n", cfg->hasVault ? v : "(not set)");
  Serial.printf("chain    %llu\n", (unsigned long long)cfg->chainId);
  Serial.printf("buttons  %s\n", cfg->swapButtons ? "swap" : "normal");
}

static void help() {
  Serial.println("hisn> wifi <0|1> \"<ssid>\" \"<pass>\" | relayer <host> [port] | token <value|none> | vault <0x...> | chain <id> | buttons <normal|swap> | show | reboot | wipe yes");
  Serial.println("hisn> address | importkey <0x key> | resetkey yes | puck only: pq [next <n>] | payee add <0x...> \"<name>\" | payee del <0x...> | payee list");
}

static void run(const String &l) {
  String argv[8];
  int argc = tokenize(l, argv, 8);
  if (argc == 0) return;
  String cmd = argv[0];
  if (cmd == "wifi" && argc >= 3) {
    int i = argv[1].toInt() == 1 ? 1 : 0;
    cfg->ssid[i] = argv[2];
    cfg->pass[i] = argc >= 4 ? argv[3] : "";
    settingsSave(*cfg);
    Serial.println("saved; reboot to apply");
  } else if (cmd == "relayer" && argc >= 2) {
    cfg->relayer = argv[1];
    if (argc >= 3) cfg->port = (uint16_t)argv[2].toInt();
    settingsSave(*cfg);
    Serial.println("saved; reboot to apply");
  } else if (cmd == "token" && argc >= 2) {
    cfg->token = argv[1] == "none" ? "" : argv[1];
    settingsSave(*cfg);
    Serial.println("saved; reboot to apply");
  } else if (cmd == "vault" && argc >= 2) {
    if (hisn_hex(argv[1].c_str(), cfg->vault, 20) == 0 && argv[1].length() == 42) {
      cfg->hasVault = true;
      settingsSave(*cfg);
      Serial.println("saved");
    } else {
      Serial.println("bad address");
    }
  } else if (cmd == "chain" && argc >= 2) {
    cfg->chainId = strtoull(argv[1].c_str(), nullptr, 10);
    settingsSave(*cfg);
    Serial.println("saved");
  } else if (cmd == "buttons" && argc >= 2 && (argv[1] == "swap" || argv[1] == "normal")) {
    cfg->swapButtons = argv[1] == "swap";
    settingsSave(*cfg);
    Serial.println("saved");
  } else if (cmd == "show") {
    show();
  } else if (cmd == "reboot") {
    ESP.restart();
  } else if (cmd == "wipe" && argc >= 2 && argv[1] == "yes") {
    settingsWipe();
    Serial.println("settings wiped; reboot");
  } else if (!(extraCmd && extraCmd(argc, argv))) {
    help();
  }
}

void consoleBegin(Settings *s, ExtraCommand extra, const String &address) {
  cfg = s;
  extraCmd = extra;
  addr = address;
  Serial.println();
  Serial.println("HISN device console. Type 'show' or 'help'.");
}

void consoleLoop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line.trim();
      if (line.length()) {
        Serial.printf("hisn> %s\n", line.startsWith("importkey") ? "importkey ****" : line.c_str());
        run(line);
      }
      line = "";
    } else if (line.length() < 200) {
      line += c;
    }
  }
}
