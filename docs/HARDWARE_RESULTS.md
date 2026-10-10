# Real puck and light on Hedera testnet

Run 2026-10-10, 03:20 to 04:06 (UTC+1), on the built devices: ESP32 puck (OLED, three buttons, PIN) and ESP32 light (red/green LED, buzzer, STOP), both on battery, Wi-Fi to the laptop relayer. Result: **every test passed**.

## Setup

- Each device made its own key on first start (path B in `HARDWARE_DAY.md`). Puck `0xaFdd81Af78d993D595f3524df9cc9FE0D6725c84`, light `0xccEa46CefF0DA8D7e52DE267cf95Ae930082fcFE`.
- The puck built its quantum-safe key tree once (256 one-time keys, root `0x38a3ce8c…09f94397`). It took **116 s** on the ESP32, not the 10 to 20 s estimated. The tree is now saved in flash and loaded on later starts.
- Vault redeployed with both device keys and the puck's quantum-safe root: `npm run redeploy:devices -- --puck … --light … --pq-root …`. Vault `0xc066F10988733ea7875817cDC8d4bF098615A061` (0.0.10963657), topic 0.0.10963660. `npm run demo:check`: all PASS.

## Tests

| # | Test | Result | Evidence |
|---|---|---|---|
| 3 | 10 USDC to a saved payee | INSTANT, paid at once, quantum-safe signature checked by the vault | payment #1, [tx](https://hashscan.io/testnet/transaction/0xa58df5d7156194998e4fd92264fdeae776e9f54dca688d4f530748513cc15ea1) |
| 4 | 100 USDC to a new address | WAIT; the light turned red and beeped within seconds | payment #2, [proposed](https://hashscan.io/testnet/transaction/0xa20003d8eafc647684f310a771560a4482bd0eeb4ed0701f100bf861f7a22668) |
| 5 | Hold STOP 2 s on the light | VETOED, signed by the light | [veto](https://hashscan.io/testnet/transaction/0x936d6e9139368d0c65e4c2820f4a286d687bcd337d23f84e7ffb8195e8afd543) |
| 7 | Hold STOP 5 s | vault frozen for 10 minutes, new requests refused | freeze until 03:37:13 |
| 6a | Second yes given after the release time | the vault paid in the same transaction | payment #3, [tx](https://hashscan.io/testnet/transaction/0xdba8c7b896d0d8e8b6a7512c11477a814080e73dbfd72130c2ccee0d5f110a79) |
| 6 | "STILL SEND?" on the puck, then **relayer stopped** | released by schedule 0.0.10964211 at the release time; recipient 3199.6 → 3299.6 tUSDC, read from the chain with the relayer off | payment #4, [confirmed](https://hashscan.io/testnet/transaction/0xab75fdeee43f5054ad275a5b217f3052828d5e0c9343a63c02481c8d7a6d77ed), [released](https://hashscan.io/testnet/transaction/0xcca1f1fcde6cd719e2f4a7055bb6a3c3f8124c99d74af59b271beb4ff7c21c1f) |
| 6b | 600 USDC to a new address | APPROVAL; nothing moved until a guardian approved on the guardian page; released by schedule 0.0.10964606; recipient 3299.6 → 3899.6 | payment #5, [approved](https://hashscan.io/testnet/transaction/0xa563cbef16fc994fa24a2637471533543869b55112d4284cc99518781c6bd58b), [released](https://hashscan.io/testnet/transaction/0xd1e428e29fb12746a1311719b7cb3ff7c269d0bd6bacf47802bdd45c61e59724) |
| 6c | After flashing the fixes: 100 USDC to a new address, "STILL SEND?" | keys loaded from flash (no rebuild), SENDING then CONFIRMED, released by schedule 0.0.10964900 | payment #6, [released](https://hashscan.io/testnet/transaction/0xd40cc8a8c8f89a5cf10d24f9201038149667dcb6e71f7f2e2566b922618ab19d) |
| 9 | Relayer stopped | light blinks yellow, puck shows NO SERVER; both reconnect by themselves when it is back | 04:05:31 to 04:06:24 |

Quantum-safe keys used after the run, as counted by the vault: 9 of 256.

## Found and fixed during the run

- **Puck buttons wired in the other order.** `buttons swap` on the console swaps YES and NO in firmware and is saved in flash; no rewiring.
- **First signature after every start rebuilt the quantum-safe tree (116 s)** and the relayer dropped the puck meanwhile, so the signature was lost. The public tree is now cached in flash, bound to the key, and reused.
- **PIN length** is one setting (`HISN_PIN_LEN`), 3 digits for the demo. `pin <old> <new>` on the console re-encrypts the existing key, so the address and the vault stay the same.
- **A STOP button held at power-on sent a freeze after 5 s** (it only failed because Wi-Fi was not up yet) and the buzzer did not stop. STOP now counts only after it has been seen released once, and the buzzer goes quiet after the freeze is sent.
- **The puck showed CONFIRMED before the vault answered**, also on a payment the guardian had already stopped. It now shows SENDING, then CONFIRMED or NOT CONFIRMED with the reason from the vault.
- **Guardian page showed "Stopping…" while approving.** The busy label now follows the button that was pressed.
- `redeploy:devices` derived the quantum-safe root from the simulator key even for a real puck. It now requires `--pq-root` with `--puck`.
