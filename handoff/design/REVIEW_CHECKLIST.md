# Backend and contract review checklist

Use in Phase 5. For each item: search for it, mark **OK**, **Missing**, **Different** or **Could not tell**, and give file and line. Do not read the whole backend. The file to open for background is named in brackets; open it only if needed.

The backend was written by teammates and may follow an older version of the design. "Different" is not automatically wrong: describe what it does and what the risk is.

## A. Money rules (contract) [system-design/02-smart-contract.md]

1. Three levels exist: instant, wait, needs approval. Which thresholds?
2. **Nothing is released on silence.** A waiting payment needs a second confirmation from the owner (or the code releases automatically after the delay: report this clearly, it is the most important difference).
3. The network timer (`scheduleCall` at `0x16b`) is called directly by the vault, never through a proxy or `delegatecall`.
4. `execute` checks: pending, not frozen, time reached, not expired, confirmed or approved.
5. A stop changes the status before any external call, and a stopped payment can never be executed afterwards.
6. Limits: are daily counters protected against the midnight double-spend (today plus yesterday)? Is the waiting total given back when a payment is stopped?
7. More than half the balance to a new recipient needs approval.
8. A signed message is rejected if its deadline is too far in the future (about 600 s).
9. Replay protection: nonce, vault address, chain id and an action code inside every signed digest.
10. Status is set before money is sent, and paying functions are non-reentrant.
11. HBAR payouts keep a gas reserve; there is a cap on waiting payments.

## B. Keys and roles (contract) [system-design/02-smart-contract.md, 12-red-team-fixes.md]

12. No owner, admin, upgrade path or `selfdestruct`.
13. **No single key other than the owner's can gain the power to pay.** In particular: can one guardian key replace the owner's key alone?
14. The alarm light's key can only stop and freeze (not approve, not recover).
15. All keys must differ; a guardian cannot be a payee.
16. A freeze ends by itself or can be renewed only by a different key.
17. The delays that protect settings have no setter.

## C. Backend service [system-design/06-backend-dashboard-agent.md]

18. No private key for the owner or a guardian is stored or logged anywhere. Which keys does the server hold?
19. Secrets come from environment variables; `.env` is git-ignored; nothing secret is committed (search the history of obvious filenames only).
20. Testnet only: no mainnet endpoints or chain ids.
21. Routes need a token or other auth; CORS is not `*` with credentials.
22. The server never calls `execute` on its own (only a manual fallback route).
23. Signature handling: the server may fix `v` and low-`s`, but checks the recovered signer before spending gas.
24. HBAR units: 8 decimals in the contract, 18 in RPC `value`. One helper, used everywhere.
25. Events are read from the mirror node with a cursor, not wide `eth_getLogs` ranges.
26. Inputs are validated (address format, positive amounts, known token); errors do not leak stack traces.
27. Alerts to the guardian do not depend on a message that can be forged or silenced ("clear" messages).
28. The agent: its key is limited by the contract, not by server code; it takes no instructions from message text; one open request at a time.

## D. Things the frontend needs that may be missing

29. A preview call that says which level a payment will get, and why.
30. Payment states that distinguish "waiting for second confirmation", "scheduled" and "needs approval".
31. Ids for proof links: transaction, schedule, topic.
32. A live channel (WebSocket or server-sent events).
33. Fact codes for the guardian alert.

## How to report

`docs/BACKEND_REVIEW.md`, one table:

| # | Item | Result | Where | Risk if left | Smallest fix | Who |
|---|---|---|---|---|---|---|

Sort by risk. Put anything that could lose money or mislead a judge at the top. End with "what we should stop claiming in the pitch if these are not fixed".
