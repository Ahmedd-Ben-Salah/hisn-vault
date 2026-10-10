# 12. Red-team review and fixes (5 Oct 2026)

Four hostile reviewers went through Hisn: a security auditor reading the design files, a fraud analyst thinking like a scammer, a sceptical investor, and a hackathon judge scoring against the rubric. This file lists what they broke, what was changed, and what is still not solved.

**Status of every fix: designed, not built, not tested.** No code exists yet. "Fixed" below means "the design files now say the right thing".

## A. Security fixes (design files 02 to 06)

| # | What was broken | Severity | Fix | Where | Build cost |
|---|---|---|---|---|---|
| 1 | One guardian key could start a puck recovery alone and become the owner | Critical | Recovery needs a second, different guardian. The alarm light is now a "watcher" key that can only stop and freeze. With one guardian, recovery is impossible. | 02, 04 (7) | 3 h |
| 2 | The guardian page was served by the relayer, so a hacked relayer could read the guardian's key | Critical | The page is a separate static site with no third-party scripts. Together with fix 1, one stolen guardian key can no longer take the vault. | 06 | 1 h |
| 3 | A waiting payment was released on silence; scammers coach victims to wait | High | The owner must confirm again on the puck after half the cool-off. No confirmation, no release. | 02, 04 (2), 05 | 4 to 6 h |
| 4 | "Move your money to a safe wallet": the victim drains the vault herself | High | More than half the vault to a new recipient always needs a guardian. The puck shows "HISN NEVER ASKS YOU TO MOVE MONEY". | 02, 03 | 2 h |
| 5 | A hostile or lost guardian could freeze the account forever | High | A freeze ends after `FREEZE_MAX` unless a different key renews it. The owner can remove a guardian alone after a long, loud wait. | 02, 04 (6) | 3 h |
| 6 | The alarm could be silenced by a fake "all clear" on the Wi-Fi | High | The light ignores any "clear" it did not cause until the release time. | 04, 05 | 1 h |
| 7 | Settings changes were signed without seeing them | High | The puck decodes and shows every change; the digest signs the real fields. | 03, 05 | 3 h |
| 8 | A stolen puck could do more than the threat model admitted | High | 6-digit PIN; the light and page alarm on every change; waiting payments need the second confirmation and can be stopped. | 05, 07 | 2 h |
| 9 | Scheduled calls could drain the gas reserve | High | The timer starts only after confirmation; at most 5 waiting payments; reserve checked in every paying function; freeze deletes timers. | 02 | 2 h |
| 10 | Payee names on the puck could drift from the chain | High | A name is inactive until the change is applied and the owner confirms it; deleted if the change dies. | 03, 05 | 2 h |
| 11 | Limits could be doubled around midnight | Medium | Every limit check counts today plus yesterday. | 02 | 1 h |
| 12 | A signed message had no latest valid time | Medium | The vault rejects deadlines more than 600 s away. | 02, 03 | 0.5 h |
| 13 | A stopped payment still used up the day's waiting limit | Medium | Veto and cancel give the amount back. | 02 | 0.5 h |
| 14 | A payment to a recipient who cannot receive USDC got stuck | Medium | The relayer checks association first; the dashboard has a Retry button. | 06 | 1 h |
| 15 | The relayer API and the agent were open to anyone on the network | Medium | API token; one open request per source; the "scam note" is built from fixed facts, not free text. | 06 | 1.5 h |
| 16 | Keys could overlap; changes survived a freeze | Medium | All keys must differ; a guardian can never be a payee; `keyEpoch` kills waiting changes. | 02 | 2 h |
| 17 | Short address display and fake log entries | Low | 8 + 8 characters; the log shows only signed or transaction-backed entries. | 03 | 1.5 h |

Total if everything is built: about 31 to 33 hours. See section D for what fits before Saturday.

## B. Scam-tactic fixes (rules and screens)

| Tactic | Change |
|---|---|
| "Just wait for the timer" | Fix 3: silence cancels. |
| "Don't tell anyone, it's confidential" | The second confirmation and the guardian alert both ask: "Has anyone told you to keep this secret or told you what to say?" |
| Scammer poses as Hisn or as the guardian | Both screens state "Hisn never calls you". Guardian approval of a large payment needs a tick: "I spoke to her on her usual number". |
| Getting added as a saved payee | `PROBATION`: a new payee cannot receive instant payments for 30 days (0 in the demo). |
| Many payments just under the limits | Rolling two-day limits now; weekly and per-recipient limits are on the roadmap. |
| Guardian presses "looks fine" out of habit | The light and page alarm only for waiting payments and changes, never for instant ones. "It looks fine" does nothing for a WAIT payment: only the owner's second confirmation releases it. |
| The guardian is the abuser | A guardian can never be a payee; freezes expire; the owner can remove a guardian alone. Two guardians recommended. |
| "Change your guardian to our officer" | Needs another guardian's yes, or a very long wait with every alarm on. |
| Fake support after a stopped payment | The "stopped" screen says: "Nobody can recover money for a fee." |
| Supplier "changed their address" | Editing a payee is not possible; a new address is a new payee, with the full wait. |

## C. Pitch and claims (file 10)

| Stop saying | Say instead |
|---|---|
| "PayPal, but protected" | "A self-custody account that gives you time and a second person." |
| "No company in the middle" | "Our server cannot move or block your money. The network releases it." |
| "Protected against scams" | "Slows the payment down and adds a second check before it leaves." |
| "More secure than..." | Nothing. Make no ranking claims. |
| "First" | "We found no one doing this combination." |
| Prices as facts | "Our guess, to be tested in interviews." |

Added to the pitch: a team slide, on-chain counts from real test runs, Bitkey and Aegis Protocol on the comparison slide, one named first customer (teams and AI agents that already hold money on chain), and an honest "what does not work" line.

## D. Scope after the judge's review

No code exists and 4.5 days remain. The judge's advice was to cut hard. This is the recommended build list; the team can overrule it.

| By | Must work |
|---|---|
| Tue night | Day-1 tests 1 to 4 on testnet. Decision: full design, or manual-release fallback. Decision: sign on the ESP32, or in the browser. |
| Wed night | Vault with INSTANT, WAIT (with second confirmation), APPROVAL, veto, and fixes 1, 3, 4, 9, 11, 12, 13. One payment end to end by script. |
| Thu night | Guardian light beeps and stops a payment on real hardware. Three screens on live data: Send, Payment detail, guardian page (hosted separately). HCS log visible. Five interviews done. |
| Fri noon | The live "server off, the network still releases" run, ten clean runs. Backup video. |

| Designed but not built for Saturday | Why |
|---|---|
| Recovery, settings changes on the puck, freeze renewal | Too much surface. They stay in the contract design and on a slide. Fixes 1, 5, 7, 10 are therefore design-only unless time remains. |
| AI agent | Build only if Wednesday's checkpoint is met. Otherwise show the Helper screens as mockups and say so. |
| Hash-based signature vault | Cut. Roadmap line only. |
| People and Protection pages, phone owner screens | Mockups exist; not wired. |

## E. What is still not solved (say it before a judge does)

1. **A patient scam that fools the owner twice and keeps the guardian quiet.** Long romance and investment scams run for weeks. The second confirmation and the guardian help; they do not make this impossible.
2. **Money that leaves by another road.** Cash, gift cards, another account, or instant payments inside the limits over many days.
3. **A hostile guardian can still stop every waiting payment** until the owner removes them, which takes a long wait by design.
4. **No refunds.** After release nobody can bring the money back.
5. **The market.** Hedera holds about $48M of stablecoins out of about $307B; most scam victims' money sits in banks and exchanges. The investor's view is that the believable first customers are teams and AI agents that already hold money on chain, not grandparents. (Figures from DefiLlama via the reviewer; re-check before using.)
6. **No user has been interviewed, no price has been tested, nothing has run on testnet.**

## F. Judge's scorecard, for reference

| | Before the fixes, plan works | Manual-release fallback | Ceiling |
|---|---|---|---|
| Total out of 100 | 63 | 46 | about 79 |

The three moves the judge said raise the score most: run the scheduled-release test and make it the live demo; five interviews with one quote and one price; a demo the judges can verify on their own phones. Whether the fixes above move the score was not re-judged.
