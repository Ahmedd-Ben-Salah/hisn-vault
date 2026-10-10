#pragma once
#include <Arduino.h>

struct Settings {
  String ssid[2];
  String pass[2];
  String relayer;
  uint16_t port = 8787;
  String token;
  uint8_t vault[20] = {0};
  bool hasVault = false;
  uint64_t chainId = 296;
  bool swapButtons = false;
  String deviceId;
};

void settingsLoad(Settings &s);
void settingsSave(const Settings &s);
void settingsWipe();
