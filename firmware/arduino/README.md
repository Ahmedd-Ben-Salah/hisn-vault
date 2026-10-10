# HISN firmware for Arduino IDE

Three sketches, ready to open in Arduino IDE 2:

| Sketch | Goes on | What it does |
|---|---|---|
| `HisnHardwareTest` | both boards, first | Checks the wiring: OLED, buttons, STOP, LEDs, buzzer. No Wi-Fi, no keys. |
| `HisnPuck` | the puck | Screen, NO / MORE / YES, PIN, signs payments (ECDSA + quantum-safe). |
| `HisnLight` | the guardian light | Ring light, buzzer, STOP button (hold 2 s = stop, 5 s = freeze). |

`HisnPuck` and `HisnLight` are generated from the PlatformIO sources in `firmware/src` and `firmware/lib`. Do not edit their `src/` folders by hand; see "For developers" at the end.

## 1. One-time setup of Arduino IDE

1. **Board package.** File → Preferences → *Additional boards manager URLs*: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. Then Tools → Board → Boards Manager → install **esp32 by Espressif Systems**. Versions 2.0.14 and 3.3.12 are tested (see the status table at the end).
2. **Libraries.** Sketch → Include Library → Manage Libraries, install:
   - **U8g2** by oliver (2.35 or newer)
   - **WebSockets** by Markus Sattler (2.4 or newer)
   - **ArduinoJson** by Benoit Blanchon (**7.x**, not 6.x)
   Do **not** install micro-ecc: a renamed copy is already inside the sketches.
3. **USB driver.** If no COM port appears when the ESP32 is plugged in, install the CP210x (Silicon Labs) or CH340 driver, depending on the chip next to the USB socket.

## 2. Board settings (Tools menu)

| Setting | Value |
|---|---|
| Board | **ESP32 Dev Module** |
| Partition Scheme | Default 4MB with spiffs (1.2MB APP) |
| Upload Speed | 921600 (use 115200 if uploads fail) |
| Erase All Flash Before Sketch Upload | **Disabled** (Enabled erases the device's key) |
| Port | the COM port of the board |

Serial Monitor: **115200 baud** and line ending **New Line** (or Both NL & CR). With "No Line Ending" the device never sees your commands.

If the upload stops at `Connecting....___`, hold the **BOOT** button on the ESP32 until the upload starts.

## 3. Test the wiring first

Open `HisnHardwareTest/HisnHardwareTest.ino`, upload, open the Serial Monitor.

- It prints the chip model (must be `ESP32`, not S2/S3/C3), scans I2C and reports the OLED at `0x3C`.
- Three rising beeps, then the LEDs go red, green, both.
- Each button press beeps and prints `NO`, `MORE`, `YES` or `STOP`. On the puck the OLED shows a live table.
- `WARNING: ... reads pressed at start` means that input is shorted to GND or wired to the wrong pins.

Fix any problem here before flashing the real firmware. It is much faster than debugging through the Wi-Fi.

## 4. Settings: `secrets.h` (optional but fastest)

Each sketch folder has `secrets.example.h`. Copy it to **`secrets.h`** in the same folder (Explorer: copy, paste, rename) and fill it in:

```c
#define HISN_WIFI_SSID "Hotspot name"
#define HISN_WIFI_PASS "hotspot password"
#define HISN_RELAYER_HOST "192.168.43.20"
#define HISN_RELAYER_PORT 8787
#define HISN_RELAYER_TOKEN "same as RELAYER_API_TOKEN in .env"
#define HISN_VAULT_ADDRESS "0x... (VAULT_ADDRESS in .env)"
```

`secrets.h` is ignored by git, so passwords never get committed. The values are only defaults: anything set later from the Serial Monitor wins, and `wipe yes` goes back to them. Leave `secrets.h` out and use the console commands below instead if you prefer.

- `HISN_RELAYER_HOST` is the **laptop's** IP address on the shared Wi-Fi (Windows: `ipconfig`, the IPv4 address of the Wi-Fi adapter). Not `localhost`.
- The ESP32 only sees **2.4 GHz** Wi-Fi. On a phone hotspot, turn on "Extend compatibility" / 2.4 GHz.

## 5. Flash and set up the guardian light

1. Open `HisnLight/HisnLight.ino`, upload, open the Serial Monitor.
2. It prints `light light-xxxxxx address 0x...`. Type `show` to see the settings.
3. **Using the key the vault already knows** (recommended, see `docs/HARDWARE_DAY.md`): type `importkey 0x<SIM_WATCHER_PRIVATE_KEY>`, then `reboot`. The printed address must equal `WATCHER_ADDRESSES` in `.env`.
4. Without `secrets.h`, set it up by hand:
   ```
   wifi 0 "Hotspot name" "password"
   relayer 192.168.43.20 8787
   token <RELAYER_API_TOKEN>
   vault 0x...
   reboot
   ```
5. After the reboot: green breathing = connected. Yellow blinking = no relayer (check the IP, the token and the laptop firewall).

## 6. Flash and set up the puck

1. Open `HisnPuck/HisnPuck.ino`, upload, open the Serial Monitor. The screen says **NEW PUCK**.
2. **Using the key the vault already knows** (recommended): type `importkey 0x<SIM_PUCK_PRIVATE_KEY>`. The screen changes to **IMPORTED KEY**.
3. Press **YES**, choose a 3-digit PIN (NO = +1, MORE = next digit, YES = next digit / done), then repeat it.
4. "PREPARING quantum-safe keys" takes about 20 seconds. The puck then shows its address. It must equal `PUCK_ADDRESS`. Press YES: it restarts.
5. Without `secrets.h`, use the same `wifi`, `relayer`, `token`, `vault` commands as the light, then `reboot`.
6. Names the puck shows instead of NEW RECIPIENT, one per saved payee:
   ```
   payee add 0xF4C9E925D3029D59E05a4AA315AbF82B9642831f "Sami"
   ```
7. `pq` prints the quantum-safe key root and how many one-time keys are left. When the puck connects, the relayer tells it how many one-time keys the vault has already seen, so keys used earlier by the simulator are skipped automatically.

## Console commands

| Command | Device | What it does |
|---|---|---|
| `show` | both | Settings, address, vault |
| `address` | both | The device's address |
| `wifi 0 "ssid" "pass"`, `wifi 1 ...` | both | Two networks, tried in turn |
| `relayer <ip> [port]` | both | Laptop running the relayer |
| `token <token>` | both | `RELAYER_API_TOKEN` |
| `vault 0x...` | both | Vault address |
| `importkey 0x<64 hex>` | both | Puck: before the PIN is created. Light: replaces its key, then `reboot`. |
| `resetkey yes` | both | Erases the key (puck: then `reboot`) |
| `pq`, `pq next <n>` | puck | Quantum-safe keys; skip forward to key `n` (never backwards) |
| `payee add 0x... "Name"`, `payee del 0x...`, `payee list` | puck | Names shown on the screen |
| `wipe yes`, `reboot` | both | Forget the settings / restart |

## Pins (same as the build guide)

| Puck | GPIO | Guardian light | GPIO |
|---|---|---|---|
| OLED SDA / SCL | 21 / 22 | Red LED (via 220 Ω) | 18 |
| NO (+1) | 32 to GND | Green LED (via 220 Ω) | 19 |
| MORE (next) | 33 to GND | Buzzer + (via 100 Ω) | 26 |
| YES (OK) | 25 to GND | STOP | 27 to GND |
| Buzzer + (via 100 Ω) | 26 | | |

## Build status

| Sketch | ESP32 core 2.0.14 | ESP32 core 3.x |
|---|---|---|
| HisnPuck | compiles, 979 KB (74 % of the app partition) | compiles (3.3.12), 1,189 KB (90 %) |
| HisnLight | compiles, 937 KB (71 %) | compiles (3.3.12), 1,136 KB (86 %) |
| HisnHardwareTest | compiles, 300 KB | compiles (3.3.12), 323 KB |

All of them compile with "Compiler warnings: All" and no warning from our code. Core 3.x makes the binaries bigger; they still fit the default partition, and "Huge APP (3MB No OTA)" is the way out if a future change does not. None of them has run on a real board yet.

## For developers

The PlatformIO project in `firmware/` stays the source of truth (native crypto tests: `pio test -e native`). After changing anything in `firmware/src`, `firmware/lib` or `platformio.ini`, regenerate the sketches and commit the result:

```
node firmware/scripts/make-arduino.mjs
node firmware/scripts/make-arduino.mjs --check
```

The generator flattens each device's files into `src/`, prefixes every `.c`/`.cpp` with `hisn_build.h` (the `-D` flags of `platformio.ini`, including the micro-ecc renames that avoid clashing with the copy inside the ESP32 SDK), and renames micro-ecc's `.inc` files to `.h`, because Arduino IDE does not copy `.inc` files into its build folder. micro-ecc is vendored in `firmware/third_party/micro-ecc` (BSD-2-Clause, commit 541b3a7).
