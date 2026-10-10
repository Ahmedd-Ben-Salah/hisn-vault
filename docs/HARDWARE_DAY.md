# Hardware day: from built devices to a working demo

Read this with `firmware/arduino/README.md` (Arduino IDE details) and the hardware build guide v2 (printing, wiring, power).

## 1. How the devices stay in sync with everything else

Arduino IDE only changes **how the firmware is built and flashed**. The code on the chip and the messages it sends are the same as before.

```
  ESP32 puck  ─┐   Wi-Fi, ws://<laptop IP>:8787/device   (signed JSON messages)
  ESP32 light ─┤
               ▼
        RELAYER on the laptop  (npm run relayer)
          │   │
          │   ├── JSON-RPC (Hashio) ─────► Hedera testnet: HisnVault contract
          │   │                              └─ Schedule service 0x16b releases waiting payments by itself
          │   ├── HCS ────────────────────► public log topic
          │   └── mirror node ◄──────────── reads events and history
          │
          ├── REST + /live websocket ─► Dashboard        (browser, http://localhost:5173)
          ├── REST ───────────────────► Guardian page    (phone browser, http://<laptop IP>:5174)
          └── REST + /live ───────────► Mobile app       (Settings → Live mode → relayer address + token)
```

- **The ESP32s never talk to Hedera directly.** They keep one WebSocket open to the relayer. The puck signs on the device and the light signs its stops; the relayer only carries the signatures to the vault and pays the gas. The vault checks every signature itself, so the relayer cannot fake or change anything.
- **Everything reads the same relayer and the same vault**, so all screens agree. A payment signed on the puck shows up on the dashboard and in the app within seconds; a STOP from the light, the app or the guardian page ends it everywhere, because the relayer watches the vault's events and pushes them to every screen and device.
- **Same network.** The laptop, both ESP32s and the phone must be on the same Wi-Fi (2.4 GHz for the ESP32s) and that Wi-Fi needs Internet: the relayer reaches Hedera, and the devices get the time from NTP (no time = "NO CLOCK", nothing can be signed).

### One payment, message by message

| # | From → to | Message |
|---|---|---|
| 1 | Dashboard / app / agent → relayer | `POST /requests {to, token, amount}` |
| 2 | Relayer → puck | `{"t":"request","reqId":7,"to":"0x…","token":"0x…","amount":"100000000"}` |
| 3 | Owner on the puck | reads the name or NEW RECIPIENT, presses YES, enters the PIN |
| 4 | Puck → relayer | `{"t":"signed","reqId":7,"nonce":"0x…","deadline":…,"r":"0x…","s":"0x…","pq":"0x…"}` |
| 5 | Relayer → Hedera | `proposePQ(...)`: the vault checks both signatures and picks INSTANT, WAIT or APPROVAL |
| 6 | Relayer → puck | `{"t":"result","ok":true,"paymentId":12,"tier":"WAIT","releaseAt":…}` |
| 7 | Relayer → light | `{"t":"alert","paymentId":12,...}`: the ring turns red and beeps; the light answers with a signed `ack` (goes to the public log) |
| 8a | Guardian holds STOP 2 s | light → relayer `veto` → vault `veto()` → everything shows VETOED |
| 8b | Half the wait later | relayer → puck `reconfirm` → "STILL SEND?" → YES + PIN → `reconfirmed` → the vault schedules the release; the network pays at the release time, even with the relayer off |

## 2. The plan: deploy tonight, swap in the hardware tomorrow

The vault is deployed for **one puck key and one light key**. Two ways to get there:

- **Path A (recommended): import the keys.** Deploy tonight with the simulated device keys and rehearse the whole demo with the simulator. Tomorrow, load the same keys into the ESP32s with `importkey`. No redeploy, no new addresses to copy around, and if a board fails on stage the simulator can take over the same keys in a few seconds.
- **Path B: fresh keys on the devices.** Flash first, let each device make its own key, then deploy the vault with those addresses. Cleaner story ("the key was born on the device"), but the deploy has to wait for the hardware.

> Say it honestly if a judge asks: in path A the keys were created on a laptop and loaded into the devices. The PIN, the screen check and the quantum-safe one-time keys still live on the puck.

### Tonight (whoever has the `.env` with `RELAYER_PRIVATE_KEY`)

1. Get the code and build:
   ```
   git fetch && git checkout anas && npm install
   npm -w contracts run build
   ```
2. Check `.env`:
   - `SIM_PUCK_PRIVATE_KEY` set, and `PUCK_ADDRESS` either empty or equal to that key's address.
   - `PQ_ROOT` **empty**: the deploy then derives the quantum-safe root from `SIM_PUCK_PRIVATE_KEY`, which is exactly what the puck will compute after `importkey`.
   - `SIM_WATCHER_PRIVATE_KEY` set, and `WATCHER_ADDRESSES` empty or equal to its address (this is the light).
   - `SIM_GUARDIAN_PRIVATE_KEYS` / `GUARDIAN_ADDRESSES`: the two guardian phones (app or guardian page).
   - `USDC_ADDRESS=0x0000000000000000000000000000000000a61b55` (tUSDC, already known to the firmware). If you ever create a new test token, also put it in `HISN_USDC_ADDRESS` in the puck's `secrets.h`.
   - `RELAYER_API_TOKEN` set to something that is not `change-me`.
   - `CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://<laptop IP>:5174` so the guardian page also works from a phone.
3. Deploy the vault with the quantum-safe layer (the current testnet vault is the older classical-only one):
   ```
   npm -w contracts run deploy:testnet
   ```
   It writes `VAULT_ADDRESS` into `.env` and `deployments/testnet.json`. Send it USDC/HBAR if the demo needs more.
4. Rehearse with the simulator:
   ```
   npm run relayer                       (terminal 1)
   npm -w backend run sim                (terminal 2, plays the puck and the light)
   npm -w dashboard run dev              (terminal 3, dashboard/.env: VITE_RELAYER_URL, VITE_RELAYER_TOKEN)
   ```
   Or the scripted story: `npm -w backend run e2e:testnet:usdc`.
5. Write on paper (not in git) for tomorrow: `VAULT_ADDRESS`, `RELAYER_API_TOKEN`, `SIM_PUCK_PRIVATE_KEY`, `SIM_WATCHER_PRIVATE_KEY`, the payee addresses and their names.

### Tomorrow

1. **Build** the puck and the light (build guide sections 04 to 07). Do the power checks of section 08 steps 1 to 3 before plugging in an ESP32.
2. **Wiring test.** Flash `HisnHardwareTest` on each board and press every button (`firmware/arduino/README.md`, step 3).
3. **Laptop.** Find its IP (`ipconfig`). Allow the relayer through the Windows firewall once (admin PowerShell):
   ```
   New-NetFirewallRule -DisplayName "HISN relayer" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
   ```
   and make sure the Wi-Fi profile is **Private**. Start `npm run relayer`. **Do not start the simulator** once the real devices are in use: it would answer as a second puck.
4. **secrets.h.** In both `firmware/arduino/HisnPuck` and `firmware/arduino/HisnLight`, copy `secrets.example.h` to `secrets.h` and fill in the Wi-Fi, the laptop IP, `RELAYER_API_TOKEN` and `VAULT_ADDRESS`.
5. **Light.** Upload `HisnLight`. Serial Monitor (115200, New Line): `importkey 0x<SIM_WATCHER_PRIVATE_KEY>`, then `reboot`. `address` must print the watcher address. The ring breathes green when it is connected.
6. **Puck.** Upload `HisnPuck`. Serial Monitor: `importkey 0x<SIM_PUCK_PRIVATE_KEY>` → screen shows IMPORTED KEY → press YES → choose the PIN twice → wait about 20 s → check the address shown equals `PUCK_ADDRESS` → YES. After the restart: `payee add 0x… "Sami"` for each saved payee. The idle screen shows "ready" with Wi-Fi bars.
7. **Check the relayer sees both:** `http://localhost:8787/health` lists the puck (role `puck`) and the light (role `watcher`) as online. The dashboard's side panel and the People page show them online too.
8. **App and guardian page.** Phone on the same Wi-Fi. App: Settings → Live mode → `http://<laptop IP>:8787` + the token; for a guardian, paste a key from `SIM_GUARDIAN_PRIVATE_KEYS`. Guardian page: `npm -w guardian run dev`, open `http://<laptop IP>:5174` on the phone.
9. **Run the tests below**, then close the cases and run them again.

### Path B instead (fresh device keys)

1. Flash both devices with `secrets.h` but **no vault address**. On the puck press YES and choose the PIN: it prints `puck address 0x…` and `pq root 0x…`. On the light type `address`.
2. In `.env`: `PUCK_ADDRESS=<puck>`, `PQ_ROOT=<pq root>`, `WATCHER_ADDRESSES=<light>`, then `npm -w contracts run deploy:testnet`.
3. On both devices: `vault 0x<new vault>` (or add it to `secrets.h`; it applies while no vault is stored).

## 3. Tests (build guide section 08, with what each screen should show)

| # | Do this | Pass when |
|---|---|---|
| 1 | Puck on battery | "HISN ready" with Wi-Fi bars; `/health` shows it online |
| 2 | Light on battery | Ring breathes green; `/health` shows the watcher online |
| 3 | Pay a saved payee 10 USDC from the dashboard | Puck shows the name, YES + PIN, "PAID"; dashboard shows EXECUTED |
| 4 | Pay a new address 100 USDC | Puck shows "!! NEW RECIPIENT !!"; after signing the light alarms within 5 s; app and dashboard show WAITING |
| 5 | Hold STOP 2 s on the light | Tone, green flash; dashboard and app say VETOED; puck shows "STOPPED BY GUARDIAN" |
| 6 | Another 100 USDC to a new address, wait half the cool-off | Puck asks "STILL SEND?"; YES + PIN; the network releases it at the release time with the relayer stopped |
| 7 | Hold STOP 5 s | Dashboard shows FROZEN; waiting payments are cancelled |
| 8 | USB plugged in while on battery | No reset, no heat |
| 9 | Unplug the light's Wi-Fi (or stop the relayer) | Light blinks yellow ("lost"); puck shows OFFLINE, "nothing is at risk" |

## 4. When something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Upload stuck at `Connecting...` | Board not in download mode | Hold BOOT during the upload; try 115200 upload speed; another USB cable (data, not charge-only) |
| No COM port | USB driver | Install CP210x or CH340 driver |
| Commands do nothing in the Serial Monitor | Line ending | Set "New Line" and 115200 baud |
| `wifi: trying …` forever | 5 GHz network, wrong password | Use 2.4 GHz; `wifi 0 "name" "pass"` with quotes |
| Light blinks yellow, puck says NO SERVER | Wrong IP, firewall, token | `show` on the device; firewall rule above; `token` must equal `RELAYER_API_TOKEN` |
| Puck says NO CLOCK | Wi-Fi without Internet | Use a hotspot with mobile data |
| "NOT SENT ... BadSignature" | Puck key differs from the vault's puck | `address` on the puck must equal `PUCK_ADDRESS` of the deployed vault |
| "NOT SENT" with `PqLeafUsed` | One-time key already used (e.g. by the simulator) | Just send again: the puck moves to the next key. Or `pq next <n>` |
| "The quantum-safe signature does not match" | Vault's PQ root is not this puck's | Redeploy with `PQ_ROOT` from the puck's `pq`, or with the same `SIM_PUCK_PRIVATE_KEY` |
| "UNKNOWN TOKEN" on the puck | Token not in the firmware's table | Use tUSDC or HBAR, or set `HISN_USDC_ADDRESS` in `secrets.h` |
| Dashboard empty, devices offline | Simulator and real devices both running, or wrong `VITE_RELAYER_URL` | Stop the simulator; check `dashboard/.env` |
| Guardian page "failed to fetch" on the phone | CORS | Add `http://<laptop IP>:5174` to `CORS_ORIGINS` and restart the relayer |

## 5. What has been checked, and what not yet

Checked on 8 to 9 October 2026:

- `HisnPuck`, `HisnLight` and `HisnHardwareTest` compile with Arduino ESP32 core 2.0.14 (the version in our Arduino IDE) and with core 3.3.12, also with "Compiler warnings: All" and no warning from our code. The puck uses 74 % of the default app partition on 2.0.14 (90 % on 3.3.12), the light 71 % (86 %).
- A `secrets.h` value ends up in the binary.
- The relayer's new `pqRoot` / `pqUsed` fields reach a device on `/device`; backend tests 29/29; the full local end-to-end story (instant, wait + second confirmation + network release, light veto, guardian approval, settings change, freeze) **ALL PASSED** with the quantum-safe layer on.

Not checked yet:

- **Nothing has run on a real ESP32.** The first flash is tomorrow: watch the Serial Monitor.
- Time to build the quantum-safe key tree on the ESP32 (estimated 10 to 20 s, once after each start, when the PIN is first used).
- The `importkey` path on hardware: confirm the address shown equals `PUCK_ADDRESS` / the watcher address before relying on it.
