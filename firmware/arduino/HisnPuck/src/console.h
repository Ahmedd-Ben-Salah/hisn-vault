#pragma once
#include <Arduino.h>
#include "settings.h"

typedef bool (*ExtraCommand)(int argc, String *argv);

void consoleBegin(Settings *s, ExtraCommand extra, const String &address);
void consoleLoop();
