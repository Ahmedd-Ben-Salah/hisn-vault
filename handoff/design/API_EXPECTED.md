# The API the screens expect

This is what the design assumed. The real backend may use other names or shapes. Phase 1 compares the two; the adapter in `src/api/` hides the differences. Types are in `types.ts`.

## Adapter interface (what components call)

| Function | Returns | Used by |
|---|---|---|
| `getState()` | `AccountState` | every page |
| `listPayments()` | `Payment[]` | Home, Payments |
| `getPayment(id)` | `Payment` | Payment detail |
| `getTimeline(id)` | `TimelineStep[]` | Payment detail |
| `previewPayment(to, token, amount)` | `Preview` | Send (live rule panel) |
| `createRequest(to, token, amount)` | `PayRequest` | Send |
| `getRequest(id)` | `PayRequest` | Send ("check your puck") |
| `stopPayment(id)` | `PayRequest`-like (needs the puck) | Home, Payment detail |
| `retryPayment(id)` | result | Payment detail (failed) |
| `freeze()` | result | Home, Protection |
| `listChanges()` / `proposeChange(kind, fields)` | `Change[]` / `Change` | People, Protection |
| `helperChat(text)` | `HelperMessage[]` | Helper |
| `subscribe(handler)` | unsubscribe function | live updates everywhere |
| `exportRecord()` | file | Payments |

Guardian build only: `guardianWaiting()` (payments and changes needing attention, read from the mirror node), `guardianFacts(id)` → `Fact[]`, `guardianStop(id)`, `guardianApprove(id)`, `guardianFreeze()`, `guardianRegister()`.

## REST and WebSocket the design assumed

| Call | Assumed endpoint |
|---|---|
| state | `GET /state` |
| payments | `GET /payments`, `GET /payments/:id`, `GET /payments/:id/timeline` |
| preview | `POST /preview` `{to, token, amount}` (if missing, compute a best guess from `getState()` and mark it "estimated") |
| request | `POST /requests` `{to, token, amount, source}`, `GET /requests/:reqId` |
| owner stop | `POST /requests` with `{cancel: paymentId}` or a dedicated route |
| guardian relay | `POST /relay/veto`, `/relay/approve`, `/relay/freeze` with `{..., r, s}` |
| second confirmation | `POST /relay/reconfirm` (sent by the puck; the UI only shows the state) |
| changes | `POST /relay/change`, `POST /relay/change/:id/approve`, `/veto` |
| manual release | `POST /fallback/execute/:id` |
| helper | `POST /agent/chat` `{message}` |
| export | `GET /export/:id` |
| live | WebSocket `/live` sending `{kind: "payment"|"change"|"state"|"device", data}` |
| health | `GET /health` |

Every route needs the API token (header name to be confirmed in Phase 1).

## Chain facts the guardian build needs

- RPC: `https://testnet.hashio.io/api`, chain id 296. Mirror node: `https://testnet.mirrornode.hedera.com`.
- Vault events (names from the design; confirm against the real ABI): `Proposed`, `Confirmed`, `Executed`, `Vetoed`, `Cancelled`, `Frozen`, `ChangeProposed`, `ChangeApproved`, `ChangeVetoed`, `ChangeExecuted`.
- Guardian actions sign a digest (layout in `system-design/03-signing-and-hcs.md`) or call `veto(id, "")`, `approve(id, "")`, `freeze("")` directly from the guardian's key.
- HashScan links: `https://hashscan.io/testnet/transaction/<id>`, `/contract/<vault>`, `/topic/<id>`, `/schedule/<id>`.

## Units

HBAR has 8 decimals inside contracts and 18 in an RPC transaction's `value`. USDC has 6. The UI works in decimal strings only; convert in the adapter.

## If the backend differs

- Different names or shapes: map them in the adapter.
- A missing read: keep the mock for that call, list it under "Needs backend".
- A missing state (for example no second-confirmation step): do **not** fake it. Show the states the backend has, and report the gap in `docs/BACKEND_REVIEW.md`, because it is a product rule, not a UI detail.
