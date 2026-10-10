# Engineering rules for the HISN repo

## What this project is

HISN Guardian is a hackathon proof of concept on **Hedera testnet only**. A smart-contract vault delays large or new-recipient payments. The Hedera Schedule Service releases them. An ESP32 "puck" signs payments it shows on its screen, and a guardian device can veto. Deadline: Saturday 10 Oct 2026, 19:00.

The full design is in `docs/`. Read the relevant file before writing code:

| Working on | Read first |
|---|---|
| Contracts | `docs/02-smart-contract.md`, `docs/03-signing-and-hcs.md` |
| Firmware | `docs/05-firmware.md`, `docs/03-signing-and-hcs.md` |
| Backend, dashboard, agent | `docs/06-backend-dashboard-agent.md` |
| Any flow | `docs/04-sequences.md` |
| What to build next | `docs/08-repo-and-backlog.md` |

## Hard rules

1. **Testnet only.** Never add mainnet configuration, endpoints or keys.
2. **Never commit secrets.** Keys live in `.env`, which is git-ignored. Never print a private key.
3. **The vault has no owner, no admin, no proxy, no `delegatecall`, no `selfdestruct`.** Do not add any of them. Scheduling from a `delegatecall` frame fails on Hedera.
4. **Do not add a setter for `SETTINGS_DELAY`, `RECOVERY_DELAY` or `MIN_COOLOFF`.**
5. **One digest definition.** The layout in `docs/03-signing-and-hcs.md` is the source of truth. TypeScript uses `shared/src/digest.ts`; firmware uses `firmware/lib/hisn_crypto`; Solidity has its own. All three must pass `shared/test-vectors.json`. If you change the layout, change all three and regenerate the vectors in the same commit.
6. **The puck never signs a hash it did not build itself** from the fields on its screen.
7. **The relayer never holds a puck or guardian key and never calls `execute` on its own.** Only the manual fallback route may call it.
8. **Standard cryptography in `HisnVault`.** The hash-based (post-quantum) check lives in the separate stateless `HisnPQVerifier`; the vault only stores the root and the used one-time keys. Byte layouts must stay identical in `shared/src/pq.ts`, `HisnPQVerifier.sol` and `firmware/lib/hisn_crypto/src/hisn_pq.c` (vectors: `npm -w shared run vectors`).
9. **Do not claim** "quantum-proof", "verified recipient", "unhackable" or "audited" in code, UI or docs. Say "quantum-resistant" or "quantum-safe signatures", and only for what `docs/QUANTUM.md` lists. Use "saved name" for payee labels.
10. **Scope is frozen** (`docs/README.md`). Do not add features outside it; put ideas in `docs/IDEAS.md`.

## Version 2 rules (from the red-team review; see `docs/12-red-team-fixes.md`)

11. **Nothing leaves on silence.** A WAIT payment is scheduled only by `reconfirm`; an APPROVAL payment only by a guardian's `approve`. Never schedule in `propose`.
12. **Three key roles besides the puck: guardian, watcher, agent. All keys differ.** A watcher (the alarm light) may only veto, veto a change, freeze and acknowledge. Never let it approve or recover.
13. **`RECOVER_PUCK` needs two different guardians.** Do not add any path where one non-puck key gains the power to pay.
14. **Every limit check counts today plus yesterday.** Veto and cancel give the waiting amount back.
15. **Reject deadlines more than 600 s away.** Check the gas reserve in every function that pays. At most 5 waiting payments.
16. **A guardian or watcher can never be a payee.** A change dies when `keyEpoch` moves.
17. **The guardian page is a separate static site** with no third-party scripts. It never loads code from the relayer.
18. **The puck shows every change it signs.** No digest over opaque bytes.
19. **Forbidden wording** in UI and docs: "PayPal", "no company in the middle", "protected against scams", "first", "more secure than". Use "our server cannot move or block your money" and "slows the payment and adds a second check".
20. **Reduced scope:** recovery, settings changes on the puck, freeze renewal and `HisnVaultPQ` are not built for Saturday. Do not start them without the team saying so.

## Hedera gotchas

- Chain id 296. RPC `https://testnet.hashio.io/api`. Mirror `https://testnet.mirrornode.hedera.com`.
- HBAR has **8** decimals inside contracts (tinybars) and **18** in ethers transaction `value`. Use `shared/src/units.ts`.
- Schedule Service is at `0x16b`. Success response code is `22`. Call it with a low-level `call` and decode `(int64, address)`.
- A scheduled second can be full (`SCHEDULE_EXPIRY_IS_BUSY`): try the following seconds.
- The vault pays the gas of scheduled calls from its own HBAR. Respect `GAS_RESERVE`.
- USDC is token `0.0.429274` = `0x0000000000000000000000000000000000068cDA`, 6 decimals. The vault must call `associate()` on that address once before it can hold USDC.
- `ecrecover` works only for secp256k1 keys. All device keys are secp256k1.
- Read events from the mirror node, not with wide `eth_getLogs` ranges.
- Transactions take a few seconds to reach the mirror node. Poll; do not assume instant.

## Honesty rules

- Anything not yet proven on testnet is listed in `docs/UNVERIFIED.md`. When a test settles an item, update that file and `docs/DAY1_RESULTS.md` with the HashScan link.
- If a test fails, say so plainly in the results file. Do not weaken a test to make it pass.
- Report what was run and what was not. "Compiles" is not "works on testnet".

## Commands

```
npm install
npm -w contracts test                    # local tests with mocks
npm -w contracts run day1 -- <1..6>             # one Day-1 test on testnet
npm -w contracts run deploy:testnet          # deploy, associate, fund, create topic
npm -w backend run dev
npm -w dashboard run dev
pio run -d firmware/puck -t upload
pio run -d firmware/guardian -t upload
pio test -d firmware -e native            # crypto test vectors
npm run demo:reset                           # back to the demo start state
```

## Style

- No comments or docstrings in code.
- TypeScript strict mode. No `any` in `shared/`.
- Solidity: custom errors, events for every state change, checks then effects then interactions, `nonReentrant` on functions that pay.
- Firmware: no dynamic allocation in the signing path; wipe key material from RAM after use.
- UI text in simple English. Status is always word plus icon plus colour.
- Small commits. Each commit message starts with the task id from the backlog, for example `T20: vault propose and tiers`.

## Order of work

Follow `docs/08-repo-and-backlog.md`. The six Day-1 tests come before everything else. Do not start `HisnVault.sol` until `docs/DAY1_RESULTS.md` has an answer for tests 1 to 4.
