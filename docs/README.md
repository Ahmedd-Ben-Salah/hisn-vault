# HISN Guardian: system design

Design date: Monday 5 Oct 2026. Deadline: Saturday 10 Oct 2026, 19:00. Hedera **testnet only**.

> **Status warning.** Nothing in this design has been run on testnet yet. The six Day-1 tests in `09-test-and-demo-plan.md` come before any other work. Anything marked **UNVERIFIED** is a guess until a test proves it.

> **Version 2 (evening of 5 Oct).** The design was attacked by four reviewers and changed. The biggest changes: nothing leaves on silence (the owner confirms a waiting payment a second time); the alarm light can only stop and freeze; replacing a lost puck needs two guardians; freezes expire; more than half the vault to a new recipient always needs a guardian. Files `02` and `04` were rewritten; files `01`, `03`, `05`, `06`, `07`, `08`, `09`, `10`, `11` have version 2 sections that win over older text in the same file. The "three levels" are now INSTANT, WAIT and APPROVAL.

## Hisn in five sentences

1. Hisn is a "slow account": a smart-contract vault that holds HBAR and USDC.
2. Small payments to people you already saved go out at once.
3. Bigger payments, or payments to someone new, wait in a cool-off.
4. During the wait, a second person (the guardian) gets a physical alarm and can stop the payment with one button, and the owner has to confirm it a second time.
5. Once confirmed, the Hedera network itself releases the payment when the wait ends, so no server of ours can speed it up or hold it back.

## How to read these files

| File | What it covers | Brief item |
|---|---|---|
| `01-architecture.md` | All the parts and how they talk | (a) |
| `02-smart-contract.md` | The vault contract: state, functions, rules | (b) |
| `03-signing-and-hcs.md` | What the devices sign, replay protection, the HCS log | (c), (e) |
| `04-sequences.md` | Step-by-step diagrams for every flow | (d) |
| `05-firmware.md` | The two ESP32 devices | (f) |
| `06-backend-dashboard-agent.md` | Relayer API, dashboard screens, AI agent | (g), (h) |
| `07-threat-model.md` | Every hostile-jury flaw and our answer | (i) |
| `08-repo-and-backlog.md` | Tech stack, folder layout, tasks by person and day | (j) |
| `09-test-and-demo-plan.md` | Day-1 tests, test plan, demo rehearsal | (k) |
| `10-pitch.md` | Six slides and jury answers | (l) |
| `11-not-built.md` | What we leave out on purpose | (m) |
| `12-red-team-fixes.md` | **Read second.** What four hostile reviewers broke on 5 Oct, every fix, the reduced scope, and what is still not solved | |
| `ENGINEERING_RULES.md` | Hard rules for everyone writing code in this repo | (j) |
| `HARDWARE_DAY.md` | **Demo day.** How the ESP32s, relayer, Hedera, dashboard and app connect; deploy tonight, flash with Arduino IDE tomorrow; tests and fixes | (f) |
| `diagrams/architecture.svg` | The big picture as an image | (a) |
| `HISN-summary.pdf` | Two-page summary | |

Sequence diagrams are written in Mermaid. GitHub and VS Code (with a Mermaid extension) draw them automatically.

## Approved scope (Phase 3)

- **MUST:** vault, network-released cool-off, puck, guardian veto (hardware and phone), two risk levels, delayed settings changes, HCS log, dashboard, payee names and daily cap, pitch and demo.
- **SHOULD:** panic freeze, lost-device recovery, AI agent, "unplug the laptop" proof.
- **COULD:** quantum-style signature in a separate vault, evidence export, secure chip.

Demo thresholds for USDC: up to 50 to a saved payee is instant; up to 500 (or any new recipient) waits (3 minutes by default) and needs the owner to confirm again before the network releases it; above 500, or more than half the vault to someone new, needs the guardian's yes.

## Words used in these files

| Word | Meaning |
|---|---|
| Vault | The smart contract that holds the money |
| Puck | The owner's ESP32 with a screen, PIN and buttons |
| Guardian light | The trusted person's ESP32 with LED, buzzer and veto button |
| Guardian page | A phone web page that does the same job as the guardian light |
| Relayer | Our backend. It carries signed messages to Hedera and pays the gas. It cannot change them. |
| Cool-off | The waiting time before a payment is released |
| Tier | The risk level of a payment: INSTANT, WAIT or APPROVAL |
| Schedule | Hedera's built-in timer that calls our contract when the wait ends (HIP-1215) |
| HCS | Hedera Consensus Service: a public, timestamped message log |

## Open questions (need the team)

1. Which exact hardware do you own: ESP32 model, OLED type (SSD1306 128x64 assumed), number of buttons, a keypad or not?
2. Who is person A (contracts and backend), B (firmware), C (dashboard, agent, pitch)?
3. Which LLM key will the agent use, and who pays for it?
4. Demo network: phone hotspot or venue Wi-Fi? ESP32 boards need 2.4 GHz.
5. Pitch language: English or French?

## Everything UNVERIFIED

| # | Item | How we find out |
|---|---|---|
| U1 | A contract with no admin key can pay out HBAR with `call{value}` | Day-1 test 1 |
| U2 | The vault can associate itself with USDC and send it | Day-1 test 2 |
| U3 | The vault can schedule a call to itself and it fires | Day-1 test 3 |
| U4 | Real gas cost of `scheduleCall`, and of the scheduled `execute` | Day-1 test 3 |
| U5 | Whether the scheduled call runs slightly before or after the chosen second | Day-1 test 3. We add 5 seconds of slack either way. |
| U6 | `deleteSchedule` called by the vault cancels its own schedule | Day-1 test 4 |
| U7 | What `msg.sender` is inside the scheduled call | Day-1 test 3. The design does not depend on it. |
| U8 | The association call works from inside a constructor | Day-1 test 2. The design uses a separate function instead. |
| U9 | A newly created testnet account can receive USDC without associating first | Day-1 test 2. Pre-associate the demo recipient anyway. |
| U10 | Hardhat deploys cleanly through the Hashio relay (chain id 296) | Day-1 test 1 |
| U11 | The `micro-ecc` library and a small Keccak file build on your ESP32 | Day-1 test 5 |
| U12 | Gas cost and transaction-size limit for the hash-based signature | Only if the quantum layer starts |
| U13 | Maximum scheduling horizon (spec says "2 months") | Not needed: our longest wait is minutes |
| U14 | Exact FBI sub-figures ($11.366B crypto, $7.748B for age 60+) | Open the IC3 2025 PDF before the pitch |
| U15 | The Tunisian central bank's own text on crypto | Ask a Dar Blockchain mentor |
| U16 | The schedule entity's fee (about $0.01) is charged to the vault | Day-1 test 3: compare balances |
| U17 | What a scheduled call that reverts costs, and who pays | Day-1 test 4: let one fire on a vetoed payment |
| U18 | A guardian's direct call from a phone arrives with the expected `msg.sender` | Wednesday, with the guardian page |
| U19 | The second-confirmation rule is usable by an older person | The five interviews; a hallway test with the mockups |
| U20 | Market figures quoted by the reviewers (Hedera about $48M of about $307B stablecoins; UK banks refunding 88%; about 40% naming a trusted contact) | Open DefiLlama, the PSR dashboard and the FINRA source before using them on a slide |
| U21 | The judge's scores (63 / 46 / ceiling 79) | One reviewer's estimate, not re-scored after the fixes |
