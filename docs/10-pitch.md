# 10. Pitch outline (5 minutes, 6 slides)

One sentence to remember: **"The scam worked on the person. It failed on the account."**

## Version 2 changes to the pitch (these win over anything below)

**One line:** "Hisn is a self-custody account that gives you time and a second person before money leaves."

**Do not say:** "PayPal but protected" (PayPal refunds; we do not). "No company in the middle" (our server carries alerts). "Protected against scams" (we slow and add a check). "First". "More secure than". Any price as a fact.

**Do say:** "Our server cannot move or block your money." "Nothing leaves on silence." "We found no one doing this combination." "We have not solved the patient scam that fools both people."

**Slides (7):**

| # | Slide | Change |
|---|---|---|
| 1 | The call | 15 seconds, one sentence. |
| 2 | The problem | One global number, one African number (INTERPOL), and **one quote from this week's interviews**. |
| 3 | Demo | 2.5 minutes, the two runs in `09`. |
| 4 | Why Hedera | The network releases; ordered public log; fixed fees. Show **counts from your own test runs** (transactions, schedules, log messages per payment). Note that other projects also use scheduled calls; the combination is yours. |
| 5 | Honest comparison | Add **Bitkey** and **Aegis Protocol** to the table. State what is not new. |
| 6 | Who pays first | **Teams and AI agents that already hold money on chain**: a capped allowance, anything larger waits for a second human. Families are the story and the pilot. One price from an interview, labelled as a guess. First market is outside Tunisia. |
| 7 | Team, what is built, what is not | Who built what. One line: "Not built: recovery, settings on the device, audit. Not solved: a scam that fools both people." Ask: one wallet introduction. |

**New hard questions to prepare** (answers in `12-red-team-fixes.md` and the investor notes):

- "Show me the network releasing a payment with your server off." (Run 2.)
- "Who holds savings in a self-custody Hedera account today?" (Almost nobody; Hedera was chosen for the scheduled call and the design ports to other chains with a keeper.)
- "Victims wait out delays. Why does this work?" (It does not stop a convinced victim alone. It forces a second look later and puts a person outside the call in the loop.)
- "What if the guardian is the abuser?" (Can stop, never pay, never be a payee; freezes expire; the owner can remove them.)
- "What did you write and what did the AI write?" (Each member walks through one file.)

## Timing

| Slide | Time | Title |
|---|---|---|
| 1 | 0:00 to 0:30 | The call |
| 2 | 0:30 to 1:10 | The problem moved |
| 3 | 1:10 to 1:40 | The insight |
| 4 | 1:40 to 3:10 | Hisn, live |
| 5 | 3:10 to 4:10 | Why Hedera, and an honest comparison |
| 6 | 4:10 to 5:00 | Who pays, and what is next |

## Slide 1: The call

- One picture: a phone ringing, "Mama" on the screen. Small label: **illustrative story**.
- Say: "She hears her son's voice. He is crying. He needs money now. It is not him. She pays. Nothing was hacked."
- No numbers on this slide.

## Slide 2: The problem moved

Three numbers, large, with sources in small print:

| Number | Source |
|---|---|
| **Wallet-drainer theft down 83%** in 2025 | Scam Sniffer |
| **Impersonation scams up 1,400%**; at least **$14B** in crypto scam revenue in 2025 | Chainalysis 2026 |
| **$20.9B** reported fraud losses in the US in 2025, over **$11B** crypto-related | FBI IC3 2025 |

- Local line: "INTERPOL: cybercrime losses in Africa rose from $192M to $484M in 2025. Scams are the top category."
- Say: "Security got better at protecting keys. So criminals stopped attacking the key and started attacking the owner."
- Honest note to say if asked: we found no Tunisian loss figure, only about 2,000 reported cybercrime cases in 2024.

## Slide 3: The insight

- Picture: two ingredients of every scam, **urgency** and **isolation**, each crossed out by **minutes** and **a second person**.
- Say: "Banks already know this works. Singapore's banks let customers lock money away, and scam losses fell from S$1.11B to S$913M in a year. Crypto accounts have nothing like it that the owner controls."
- Do not claim the lock alone caused the fall. Say "fell in the same year".

## Slide 4: Hisn, live

- The 60-second demo from `09-test-and-demo-plan.md`.
- Then one picture of the three tiers:

| Payment | What happens |
|---|---|
| Small, to someone saved | Instant |
| Bigger, or someone new | Waits; the guardian's alarm goes off; one button stops it |
| Large | Nothing moves without the guardian's yes |

## Slide 5: Why Hedera, and an honest comparison

Left half, three Hedera facts used in the demo:

1. **The network releases the payment** (scheduled contract calls, HIP-1215). No server of ours, no keeper bot, no custodian.
2. **Every approval, alert and veto is timestamped in fair order** on HCS, for $0.0008 a message.
3. **Fixed, tiny fees**: a transfer costs $0.0001, so protection does not cost more than the payment.

Right half, a small table:

| | Delay | Second person | Who releases | Hardware screen | Stops a persuaded owner? |
|---|---|---|---|---|---|
| Coinbase Vault | 48 h | co-approvers | Coinbase | no | partly, custodial |
| Argent (now Ready) | yes | guardians | a relayer | no | built for lost or stolen keys |
| Safe + Zodiac Delay | yes | the Safe's owners | someone must execute | no | built for DAOs |
| **Hisn** | yes | physical guardian | **the Hedera network** | **yes** | **this is the goal** |

Say: "Delay and guardians are not our invention, and we will not pretend they are. Ours is the first we know of where the network itself releases the money and the second person holds a physical alarm."

The competitor rows come partly from secondary sources (the Coinbase 48 h figure and the "who releases" column for Argent and Zodiac). Open each product's own documentation on Friday and correct the table if needed.

Before using "first we know of", search once more on Friday. If in doubt, drop the phrase.

## Slide 6: Who pays, and what is next

- **Who pays (hypotheses, not yet validated):** wallets and exchanges per protected account; fintechs adding stablecoin accounts; families (guardian plan); companies that give AI agents a budget.
- Say plainly: "We have not interviewed customers yet. That is our first job after today."
- **Roadmap:** phone-native guardian with secure storage; wallet SDK; agent mode for businesses; hash-based keys for the guardian light too; a standard scheme (SLH-DSA / XMSS) and an audit; Hedera's own post-quantum account keys when they ship.
- **Ask:** mentoring from Dar Blockchain and one wallet partner for a pilot on testnet.
- Close: "Hisn means fortress. The scam can work on the person. It should fail on the account."

## Likely jury questions and short answers

| Question | Answer |
|---|---|
| **"This is Argent on Hedera."** | "On the logic, largely yes, and we do not claim the idea. Two things differ. Argent protects against a stolen key; we protect against an owner who was talked into it, so the veto belongs to someone outside the conversation with an alarm in their hand. And Argent needs a relayer to execute after the delay; here the network does it, so there is no server to rush, bribe or switch off." |
| **"Does this need Web3?"** | "A bank can do this inside its own system. A self-custody account cannot, because nobody stands between the owner and the money. We put the delay and the second person into the account itself, with no company in the middle." |
| **"Why Hedera and not Ethereum?"** | "Three things we use: the network runs our contract at the release time by itself, HCS gives ordered timestamps for a fraction of a cent, and fees are fixed in dollars. On Ethereum we would need a keeper service and would pay variable gas." |
| **"Does it create accounts and transactions?"** | "Yes: each vault is a contract account, each protected payment is three or more transactions, a schedule entity and about six HCS messages. Here are today's on HashScan." |
| **"Did you talk to a real user?"** | "No, not yet. We built on published data and on what banks already found to work. Interviews with a wallet and with families are the first step after the hackathon." Do not invent a user. |
| **"What if the guardian is asleep?"** | "For medium amounts, the payment goes after the wait; that is the owner's own limit. For large amounts, silence is not consent: nothing moves without a yes." |
| **"What if the scammer says: just wait?"** | "Then he must also fool a second person who is not on the call. The wait is not the defence. The second person is." |
| **"What if the guardian is the thief?"** | "A guardian can stop money but can never move it. The worst a bad guardian can do is start a device recovery, which the owner cancels from her puck during a long delay." |
| **"ESP32 is not secure hardware."** | "Correct. So a stolen key is limited by design: small payments to saved people, capped per day. Everything else alarms the guardian. A secure chip is a known upgrade." |
| **"What about the Term Finance hack?"** | "Their cooldown could be voted to zero. Ours has no setter. Every other rule change needs the device, a guardian's yes and a delay." Only say this if T21 is built and tested. |
| **"Is it quantum-safe?"** | "The part that moves money is. Every payment needs a second, hash-based signature from the puck, built only from Keccak-256, and the vault checks it on Hedera. Breaking ECDSA with a quantum computer is not enough. What stays classical: Hedera's own transaction keys, the guardian keys (they can only stop or approve) and the helper's small allowance. Details in `docs/QUANTUM.md`." |
| **"Why would anyone carry a device?"** | "The device is for the demo and for high-value accounts. The same guardian works from a phone, which you just saw." |
| **"How do you make money?"** | "Per protected account, paid by the wallet or fintech, because every prevented scam is a support case and a lost customer avoided. This is a hypothesis." |
| **"Is this legal in Tunisia?"** | "We run on testnet with play money only. The first market is outside Tunisia until the rules change." |

## Slide design notes

- One idea per slide, large type, dark text on light background, one accent colour.
- Every number has its source at the bottom in small print.
- Put the word **SIMULATED** on screen during the call.
- The last slide stays up during questions: QR codes for the repo, the vault on HashScan and the HCS topic.
