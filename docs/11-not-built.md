# 11. Deliberately not built

| Not built | Why |
|---|---|
| **Anything on mainnet or with real money** | Tunisian rules; hackathon rules. |
| **Recipient identity checks or KYC** | No name registry exists for crypto addresses. We show a saved label or `NEW RECIPIENT` and never say "verified". |
| **An account whose only key is a contract** | The original idea. Never shown to work for sending money out; Hedera's own tests fail with `INVALID_SIGNATURE` when updating an account to a contract key. |
| **HIP-1195 hooks** | Not confirmed live on any public network. |
| **Proxy or upgradeable contract** | Scheduling from `delegatecall` fails (issue #27263), and upgradeability would bring back an admin. |
| **Duress PIN** | It answers physical coercion. A phone-scam victim would enter the normal PIN. |
| **x402 pay-per-check API, wallet SDK, insurer plan** | No demand evidence and no time. Roadmap slide only. |
| **Custom-fee HCS topics (HIP-991)** | About $0.05 per message, wrong for a log. |
| **A keeper bot** | The point is that the network releases the payment. Only a manual fallback button exists. |
| **Automatic scheduling of settings changes** | Saves vault HBAR. A person presses "Apply". |
| **More tokens than HBAR and USDC** | Each token needs association and limits. Two are enough to show the idea. |
| **Multiple vaults per relayer, user accounts, login** | One vault, one demo. |
| **Mobile apps** | The guardian page is a web page. |
| **Secure element (ATECC608)** | Only if you already own one and everything else is done. |
| **Standard-conformant XMSS or SLH-DSA** | Built: a simplified XMSS-style scheme (WOTS w=16, Merkle height 8, tweaked Keccak hashes). Not a standard, not audited. |
| **AI scam detection as a headline feature** | Evidence that warning text changes behaviour is weak. The agent writes one advisory line, nothing more. |
| **Privacy** | Amounts and addresses are public on chain and in HCS. Out of scope. |
| **A formal audit** | Not possible in the time. The repo says "unaudited proof of concept". |
| **Hash-based keys for guardians and the alarm light** | Only the puck has them. Guardian keys can stop, freeze and approve a payment that the puck already signed with its hash-based key. See `docs/QUANTUM.md`. |
| **Recovery, settings changes on the puck, freeze renewal (for Saturday)** | Designed in version 2 and kept in the contract design, but too much to build and test in 4.5 days. Shown on a slide, stated as not built. |
| **Weekly and per-recipient limits** | Version 2 has rolling two-day limits. Longer windows are roadmap. |
| **Second guardian onboarding, guardian without hardware (passkey), alerts by Telegram** | Needed for a real product; roadmap. |
| **Refunds or reversal after release** | Not possible without a company holding the money. Never promised. |
| **The "Nouba" irrigation project** | It stays the written fallback if the whole approach fails on Day 1. |
