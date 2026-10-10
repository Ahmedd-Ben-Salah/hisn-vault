#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "settings.h"

typedef void (*MessageHandler)(JsonDocument &msg);

enum LinkState { LINK_NO_WIFI, LINK_NO_CLOCK, LINK_NO_RELAYER, LINK_UP };

void linkBegin(Settings *s, const char *role, const String &address, MessageHandler onMessage);
void linkLoop();
void linkSetAddress(const String &address);
LinkState linkState();
bool linkSend(JsonDocument &msg);
uint64_t linkNow();
bool linkClockOk();
int linkWifiBars();
