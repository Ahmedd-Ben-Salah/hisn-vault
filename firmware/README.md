# HISN firmware

Two ESP32 programs built from one PlatformIO project: the **puck** (screen, three buttons, PIN, signs payments) and the **guardian light** (LED, buzzer, one big button, can only stop or freeze).

**Flashing with Arduino IDE:** open the ready sketches in `arduino/` and follow `arduino/README.md`. They are generated from this project with `node scripts/make-arduino.mjs`. The demo-day steps for the whole system are in `docs/HARDWARE_DAY.md`.

## Build and test

```
pio test -e native
pio run -e puck
pio run -e light
```

`pio test -e native` checks the signing code on the PC against `shared/test-vectors.json`, the same vectors the contract and relayer tests use. Run `node scripts/gen-vectors.mjs` after the vectors change.

## Wiring

| Puck | Pin |
|---|---|
| OLED SSD1306 128x64 SDA / SCL | 21 / 22 |
| Button UP (NO, +1) | 32 to ground |
| Button NEXT (MORE) | 33 to ground |
| Button OK (YES) | 25 to ground |
| Buzzer | 26 |

| Light | Pin |
|---|---|
| Red LED / green LED | 18 / 19 |
| Buzzer | 26 |
| Big button (STOP) | 27 to ground |

Other pins: add `-DPIN_OK=...` (and so on) to `build_flags` in `platformio.ini`.

## Flash and provision

1. `pio run -e puck -t upload` (or `-e light`), then `pio device monitor`.
2. In the monitor:
   ```
   hisn> wifi 0 "Venue WiFi" "password"
   hisn> wifi 1 "Phone hotspot" "password"
   hisn> relayer 192.168.1.20 8787
   hisn> reboot
   ```
3. Puck: press OK, choose a 3-digit PIN twice. The address is shown and printed; the puck reboots. Light: the address is printed at boot (`hisn> address`).
4. Put the addresses in `.env` as `PUCK_ADDRESS` and `WATCHER_ADDRESSES`, deploy the vault, then on both devices:
   ```
   hisn> vault 0x...
   ```
5. Puck only, names it shows instead of NEW RECIPIENT: `hisn> payee add 0x... "Sami (son)"`.

To use keys the vault was already deployed with (the simulator's), type `importkey 0x<private key>` before choosing the PIN on the puck, or at any time on the light followed by `reboot`. Wi-Fi, relayer, token and vault can also come from build-time defaults (`-DHISN_WIFI_SSID=...` here, `secrets.h` in the Arduino sketches).

## Using the puck

| Screen | UP | NEXT | OK |
|---|---|---|---|
| Review a payment | refuse | full address | PIN, then sign |
| Still send? | cancel (PIN) | full address | PIN, then confirm |
| PIN | digit +1 | next digit | next digit; on the last digit, done |
| Idle | | hold: menu | |

Each PIN digit starts at a random value. Ten wrong PINs erase the key.

## Using the light

- Green breathing: calm. Red blinking: a payment is waiting, faster in the last 30 s. Red and green: a large payment needs a guardian. Slow red: a settings change. Yellow: no server.
- Hold 2 s: stop every waiting payment and change it is alarming about. Hold 5 s: freeze the account.
- An "all clear" it did not cause leaves it dim red until the release time has passed.

## Virtual puck (Wokwi)

`wokwi/` runs the puck firmware on a simulated ESP32 with the same wiring, through the relayer's tunnel, before any board is soldered.

1. Build the simulation firmware: `pio run -e puck_sim`. It is the normal puck plus three test-only changes: PIN digits start at 0, `simkey` loads the simulated puck key, and each screen change is printed. Never flash it to a real board.
2. Put `WOKWI_CLI_TOKEN` (from wokwi.com/dashboard/ci) in `.env`, start the relayer and the tunnel, and stop the node device simulator.
3. `node wokwi/run-puck.mjs https://<tunnel>.trycloudflare.com`

The runner configures the virtual puck over its serial console, sends a 60 USDC payment request to Sami, and presses YES and the PIN on the virtual buttons for the payment and for "STILL SEND?". It passes when the vault reports the payment executed by the network. Screenshots of each screen go to `~/.cache/hisn-docs/wokwi/`.

Two settings exist on real devices too: `token <value|none>` sends the relayer's API token, and port 443 makes the link use TLS. Neither is needed on the demo hotspot.
