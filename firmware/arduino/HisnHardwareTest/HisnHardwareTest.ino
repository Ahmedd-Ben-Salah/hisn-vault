#include <Wire.h>
#include <U8g2lib.h>

const int PIN_SDA = 21;
const int PIN_SCL = 22;
const int PIN_NO = 32;
const int PIN_MORE = 33;
const int PIN_YES = 25;
const int PIN_STOP = 27;
const int PIN_BUZZ = 26;
const int PIN_RED = 18;
const int PIN_GREEN = 19;

const int INPUTS[] = {PIN_NO, PIN_MORE, PIN_YES, PIN_STOP};
const char *NAMES[] = {"NO", "MORE", "YES", "STOP"};
const int TONES[] = {1800, 2200, 2600, 900};

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
bool hasOled = false;
uint8_t oledAddr = 0;
bool wasDown[4] = {false, false, false, false};
uint32_t presses[4] = {0, 0, 0, 0};
uint32_t lastDraw = 0;

void scanI2c() {
  Wire.begin(PIN_SDA, PIN_SCL);
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("i2c: device at 0x%02X\n", a);
      found++;
      if (a == 0x3C || a == 0x3D) oledAddr = a;
    }
  }
  if (!found) Serial.println("i2c: nothing found on SDA 21 / SCL 22 (no OLED, or SDA/SCL swapped, or VCC/GND wrong)");
  hasOled = oledAddr != 0;
  if (hasOled) Serial.printf("OLED: found at 0x%02X%s\n", oledAddr, oledAddr == 0x3C ? " (expected)" : " (firmware expects 0x3C)");
}

void lights(int red, int green) {
  analogWrite(PIN_RED, red);
  analogWrite(PIN_GREEN, green);
}

void startupShow() {
  Serial.println("buzzer: three rising beeps");
  tone(PIN_BUZZ, 1500, 150);
  delay(250);
  tone(PIN_BUZZ, 2200, 150);
  delay(250);
  tone(PIN_BUZZ, 2900, 150);
  delay(300);
  Serial.println("LEDs: red 1 s, green 1 s, both 1 s");
  lights(255, 0);
  delay(1000);
  lights(0, 255);
  delay(1000);
  lights(255, 255);
  delay(1000);
  lights(0, 0);
}

void draw() {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 9, "HISN HARDWARE TEST");
  for (int i = 0; i < 4; i++) {
    char line[24];
    snprintf(line, sizeof(line), "%-4s %s %lu", NAMES[i], wasDown[i] ? "DOWN" : "up  ", (unsigned long)presses[i]);
    oled.drawStr(0, 24 + 11 * i, line);
  }
  oled.drawFrame(0, 0, 128, 64);
  oled.sendBuffer();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== HISN hardware test ===");
  Serial.printf("chip %s rev %d, %d cores, %lu MHz, flash %lu MB, MAC %012llX\n", ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(),
                (unsigned long)ESP.getCpuFreqMHz(), (unsigned long)(ESP.getFlashChipSize() / (1024 * 1024)), (unsigned long long)ESP.getEfuseMac());
  for (int i = 0; i < 4; i++) pinMode(INPUTS[i], INPUT_PULLUP);
  pinMode(PIN_BUZZ, OUTPUT);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_GREEN, OUTPUT);
  scanI2c();
  if (hasOled) {
    oled.setI2CAddress(oledAddr * 2);
    oled.begin();
    draw();
  }
  for (int i = 0; i < 4; i++) {
    if (digitalRead(INPUTS[i]) == LOW) Serial.printf("WARNING: %s (GPIO %d) reads pressed at start: shorted to GND or wired to the wrong pins\n", NAMES[i], INPUTS[i]);
  }
  startupShow();
  Serial.println("Press each button. Puck: NO, MORE, YES. Guardian light: STOP (red LED while held).");
}

void loop() {
  uint32_t ms = millis();
  bool changed = false;
  for (int i = 0; i < 4; i++) {
    bool down = digitalRead(INPUTS[i]) == LOW;
    if (down != wasDown[i]) {
      delay(20);
      if ((digitalRead(INPUTS[i]) == LOW) != down) continue;
      wasDown[i] = down;
      changed = true;
      if (down) {
        presses[i]++;
        tone(PIN_BUZZ, TONES[i], 80);
        Serial.printf("%s (GPIO %d) pressed, %lu so far\n", NAMES[i], INPUTS[i], (unsigned long)presses[i]);
      } else {
        Serial.printf("%s released\n", NAMES[i]);
      }
    }
  }
  if (wasDown[3]) {
    lights(255, 0);
  } else {
    int v = (int)(40 + 40 * sin(ms / 900.0));
    lights(0, v);
  }
  if (hasOled && (changed || ms - lastDraw > 500)) {
    lastDraw = ms;
    draw();
  }
  delay(5);
}
