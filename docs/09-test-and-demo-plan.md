# 09. Test plan and demo rehearsal plan

## Part 1: the six Day-1 tests

None has been run yet. Each is one script in `contracts/scripts/day1/`. Each prints PASS or FAIL and a HashScan link, and appends a line to `docs/DAY1_RESULTS.md`.

| # | Test | PASS means | Also record | If it FAILS |
|---|---|---|---|---|
| 1 | Deploy a minimal vault through Hashio. Send it 20 HBAR. Call `payout(to, 1 HBAR)`. | The recipient's balance rises by exactly 1 HBAR | What HashScan shows as the contract's admin key; the tinybar and 18-decimal handling | Check units first. If deployment itself fails, deploy with the Hedera SDK instead of Hardhat. |
| 2 | The vault calls `associate()` on USDC, receives faucet USDC, sends 1 USDC out with `transfer`. | Balances move as expected | Whether `associate()` also works in a constructor; whether a fresh recipient needs to associate first | Try the HTS system contract at `0x167` (`associateToken`, `transferToken`). If USDC cannot work at all, demo with HBAR only. |
| 3 | The vault calls `scheduleCall` on `0x16b` for its own `execute(1)`, 120 s ahead, with a plain call. | `execute(1)` runs with no transaction from us; the HashScan schedule page shows it executed | Gas used by `scheduleCall`; gas used by the scheduled call; `block.timestamp` inside it minus the chosen second; `msg.sender` inside it; HBAR taken from the vault | Retry with a different gas limit and a later second. Try `scheduleCallWithPayer`. After two hours with no success: **manual-execute fallback**, and change the pitch. |
| 4 | Schedule as in test 3, then call `deleteSchedule` from the vault before the time. | Nothing executes; the schedule shows as deleted | Response code | Not blocking: `execute` reverts on a vetoed payment anyway. The demo then shows a failed execution instead of a deleted schedule. |
| 5 | The ESP32 builds a PAY digest, signs it; a test contract recovers the signer. Then change one byte of the amount. | Right address on the first call; a different address on the second | Time to sign on the device | Check Keccak versus SHA3 padding, low `s`, and `v`. Compare each step with `test-vectors.json`. |
| 6 | Create a topic with no submit key. Post two JSON messages 10 s apart. Read them from the mirror node. | Both come back in order with consensus timestamps about 10 s apart | Delay until the mirror shows them | Use the SDK's topic subscription instead of REST. |

**Decision meeting after the tests (task T13).** Go through the table, update `UNVERIFIED.md`, and choose: full design, or manual-execute fallback.

## Part 2: ongoing tests

| Level | What | Where | When |
|---|---|---|---|
| Unit: contract | Every function, every revert reason, tiers at the exact boundary values (50, 50.000001, 500, 500.000001), daily counters across midnight, replay, deadline, epoch, reentrancy with `EvilReceiver`, timer mock success, busy and failure | Hardhat local with mocks | Every commit |
| Unit: crypto | Digests, wrapped hashes, addresses and signatures against `test-vectors.json` in TypeScript, Solidity and native C | Vitest, Hardhat, `pio test -e native` | Every commit |
| Integration | Relayer plus a **device simulator** (a script that plays puck and guardian over WebSocket), against local Hardhat | `backend/test/` | Daily |
| Testnet smoke | One instant payment, one waiting payment released by the network, one veto, one approval, one freeze | Script `scripts/smoke.ts` | After every deploy, and Saturday morning |
| Hardware | Real puck and light through the full flow, ten times in a row | The bench | Wednesday night onwards |
| Soak | Leave everything on for one hour; trigger a payment every five minutes | The bench | Friday |

The **device simulator** is worth building early: persons A and C can work without waiting for hardware, and it is the fallback if a board dies on stage.

## Part 3 (version 2): a demo the judges can check themselves

The judge's review found that the old script never showed the headline claim live, looked staged, and would overrun. This replaces it. Budget: **2.5 minutes**, two runs.

**Before going on stage**

- Three printed QR codes, each a different pre-prepared recipient address (all able to receive USDC).
- A QR code to the HCS topic on HashScan and one to the vault.
- A camera or phone pointed at the puck, shown on the projector.
- Phone hotspot (2.4 GHz), never the venue Wi-Fi.
- Cool-off set to 60 seconds; say "one minute here, hours in real life".

**Run 1: the guardian stops it (about 60 s)**

| Step | What happens | How a judge can check it |
|---|---|---|
| 1 | One sentence, no theatre: "A caller with her son's voice says: send 100 dollars now." | |
| 2 | **A judge picks one of the three QR codes.** That address is the recipient. | The judge chose it, so it is not staged. |
| 3 | The owner approves on the puck: `NEW RECIPIENT, 100.00 USDC`. | Camera on the puck. The proposal appears on HashScan before the light reacts. |
| 4 | The light turns red and beeps. **Hand it to a second judge**, who scans the HCS QR on their own phone. | The alert entry appears in the public log on the judge's phone. |
| 5 | The judge holds STOP. | The stop appears in the log with a timestamp before the release time. The vault balance is unchanged. |

**Run 2: the network releases it with our server off (about 75 s)**

| Step | What happens | How a judge can check it |
|---|---|---|
| 1 | Same payment, smaller amount to a saved-but-over-limit case or a new recipient. The owner approves, then confirms again at 30 seconds. | Both signatures appear in the log. |
| 2 | **Close the laptop lid / kill the relayer, on stage.** Keep talking through the "why Hedera" slide. | Everyone sees the server go off. |
| 3 | At 60 seconds the payment lands. | A judge refreshes the recipient address and the schedule page on their own phone: executed by the network. |

Closing line: "The scam can work on the person. It has to get past time, a second look, and a second person before it works on the account."

**What changes if a test failed**

| If | Then |
|---|---|
| Test 3 (scheduled release) failed | Run 2 becomes: press Execute by hand after the wait, and say plainly "the delay is enforced by the contract; automatic release by the network did not work for us on testnet". Do not claim network release. |
| ESP32 signing failed | The owner signs in the browser; the light is the only hardware. Say so. |
| Testnet is slow | Play the backup video, then show yesterday's transactions on HashScan. |

**Rehearsal (replaces the old schedule):** first end-to-end run Wednesday night; backup video Thursday; ten clean runs of Run 2 by Friday noon; each team member explains one file aloud on Friday.

## Old 60-second script (superseded, kept for reference)

### Setup before going on stage

- Vault: 150 USDC, 40 HBAR. Demo recipient ("the scammer") already associated with USDC.
- A second, ordinary testnet account with 100 USDC for the "without Hisn" half.
- Demo cool-off for this run: **60 seconds**. The contract allows it (`MIN_COOLOFF` is 60 s). Three minutes of silence on stage is too long. Say aloud: "one minute here, hours in real life."
- The amount is **100 USDC**, because the testnet faucet gives only 20 USDC every two hours. Say "one hundred" consistently, on slides too.
- Laptop: dashboard on the Side-by-side screen. Phone: guardian page open. Puck and light powered from battery packs.
- `pnpm demo:reset` has been run and shows all green.

### Script

| Time | What happens | Who | Screen |
|---|---|---|---|
| 0:00 | Play the clearly labelled **SIMULATED** voice call: "Mama, I had an accident, send 100 USDC now." | Speaker 1 | Caption: "Simulated call. Team member's own voice, with consent." |
| 0:08 | Normal account: press Send. The money is gone. | Speaker 1 | Left panel: HashScan shows the transfer, a few seconds |
| 0:15 | Hisn: the same request. The puck shows `NEW RECIPIENT, 100.00 USDC, wait 1 min`. The "victim" enters the PIN. | Speaker 2 on the puck | Right panel: PAYMENT WAITING, countdown ring |
| 0:25 | The guardian light turns red and beeps. Hand it to a **judge**. | Speaker 2 | Timeline: Signed, Proposed, Guardian alerted |
| 0:35 | The judge holds VETO. Long beep, green. | Judge | Timeline: Vetoed, with the consensus timestamp before the release time |
| 0:45 | Open the HashScan schedule page: **deleted**. Open the HCS topic: veto logged. | Speaker 1 | HashScan |
| 0:55 | "The scam worked on the person. It failed on the account." | Speaker 1 | Final slide |

Bonus, only if asked or if time allows: show the recorded "unplug the laptop" clip, where the release fires with our backend off.

### Rehearsal plan

| When | What |
|---|---|
| Thursday night | First full run, no stopwatch. Note every stumble. |
| Friday 14:00 | Three timed runs. Target 60 s, hard limit 75 s. |
| Friday 16:00 | Record the **backup video**: one clean take of the full demo, screen and hands in frame, HashScan links readable. |
| Friday evening | One run with a deliberate failure each: light unplugged (use the phone page), relayer killed after propose (network still releases), Wi-Fi dropped. |
| Saturday morning | Two runs on the venue network. |
| Saturday, 30 min before | `demo:reset`, check balances, check batteries, open every tab. |

### Fallbacks on stage

| Problem | Do this |
|---|---|
| Testnet slow (a transaction takes more than 15 s) | Keep talking through slide 3 while it lands. If it passes 40 s, say "testnet is slow today" and play the backup video. |
| Testnet down | Play the backup video. Show yesterday's transactions on HashScan, which are permanent. |
| Guardian light fails | Give the judge the phone with the guardian page. |
| Puck fails | Run the device simulator from the laptop and say so. |
| Venue Wi-Fi fails | Phone hotspot (2.4 GHz); devices are already provisioned for both networks. |
| Veto not confirmed in time | Let it release, then say: "That is the medium tier. For large sums nothing moves without a yes," and show the APPROVAL screen. |

### What to have printed

- One page with the vault address, topic id and HashScan QR codes for judges.
- The architecture picture.
