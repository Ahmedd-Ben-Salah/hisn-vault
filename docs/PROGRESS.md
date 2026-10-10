# Progress (branch `frontend-review-fixes`, continued on `anas`)

## Hardware with Arduino IDE (branch `anas`): see `docs/HARDWARE_DAY.md`
- `firmware/arduino/HisnPuck`, `HisnLight`: ready-to-open Arduino IDE sketches, generated from the PlatformIO sources by `firmware/scripts/make-arduino.mjs` (`--check` fails when they are stale). micro-ecc is vendored and renamed, so no extra library and no build flags are needed.
- `firmware/arduino/HisnHardwareTest`: wiring test for both boards (OLED, buttons, STOP, LEDs, buzzer), no Wi-Fi or keys.
- Firmware: Wi-Fi, relayer, token and vault can come from `secrets.h` (git-ignored) instead of the console; `importkey` loads the key the vault was deployed with (puck: before the PIN; light: any time); `pq next <n>` skips used one-time keys; an optional extra USDC address.
- Relayer: the puck's `state` message carries `pqRoot` and `pqUsed`, so a puck that takes over the simulator's key skips the one-time keys the vault has already seen.
- Checked: the three sketches compile on ESP32 core 2.0.14 and 3.3.12 with all warnings on; backend 29/29; `e2e:local` ALL PASSED. Not checked: anything on a real board.

## Quantum-resistant signatures (main focus): see `docs/QUANTUM.md`
- Hybrid ECDSA + hash-based (WOTS w=16, Merkle height 8) signatures from the ESP32 puck for every payment, second confirmation and settings change; the vault checks both on-chain through the stateless `HisnPQVerifier`.
- The same scheme in TypeScript (`shared/src/pq.ts`), Solidity and C (`firmware/lib/hisn_crypto/src/hisn_pq.c`), proven identical by shared vectors.
- Puck firmware: seed derived from the PIN-protected key, one-time-key counter committed before signing, `pq` console command, "no keys left" warning. Simulator, relayer and deploy scripts updated. Dashboard shows the status and keys left.

## Backend and contract fixes
See the "Status" table at the top of `docs/BACKEND_REVIEW.md`. Open: #8 (deadline on guardian signatures), blocked by the 24 KB contract-size limit.

## Frontend
Redesign from `handoff/design/` (see the previous commit). Stop and Freeze now go to the puck through the relayer.

## Verified
- Contracts 72, shared 13, backend 29, dashboard 37, guardian 3: all pass. Builds pass.
- `npm -w backend run e2e:local`: ALL PASSED with the PQ layer on (the vault checked 7 hash-based signatures).
- Firmware C crypto: compiled with gcc and checked against the TypeScript vectors (4/4).

## Not verified
- The ESP32 firmware was **not compiled with PlatformIO or run on hardware** (no toolchain here). Run `pio run -e puck` and `pio test -e native` before flashing. Key generation time on the ESP32 is an estimate (10 to 20 s).
- Testnet: the deployed vault is the old classical-only one. A redeploy is needed for the PQ layer and the contract fixes (`PQ_ROOT` from the puck's `pq` command).
