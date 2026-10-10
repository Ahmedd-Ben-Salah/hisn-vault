# Backend and contract review

Branch `frontend-review-fixes` (on `origin/anas/experience`). This started as a review only; the fixes listed under "Status" were applied afterwards on this branch.
Tests run on 2026-10-06: `npm -w contracts test`: **60 passing**. `npm -w backend test`: **21 passed (3 files)**.
Line numbers are from `contracts/contracts/HisnVault.sol` (abbreviated `Vault`) and `backend/src/*`.

## Status after the fix pass (2026-10-07)

| # | Finding | Status |
|---|---|---|
| 21, 27 | Open routes, unauthenticated `/device`, anyone could reject as the puck | **Fixed.** Testnet refuses to start without `RELAYER_API_TOKEN`; `/device` checks the token (devices: console `token ...`); only the current puck may reject. |
| 16 | One key could keep the vault frozen | **Fixed in the contract.** After a freeze, that guardian or light key waits `FREEZE_MAX + 2 x RECOVERY_DELAY + APPROVAL_WINDOW` before it can freeze again (the owner's puck is exempt). Needs a redeploy. |
| 7 | More than half the balance to a payee on probation went to WAIT | **Fixed in the contract** (`!saved` instead of `since == 0`). |
| 8 | Guardian approve/veto/freeze signatures have no deadline | **Open.** Adding the deadline puts the vault over the 24 KB limit (74 bytes left). Next step: move the change-handling code into a library. Risk stays low: each signature is single-use per payment or epoch. |
| 23 | `finishSignature` gave up on the first bad candidate | **Fixed.** |
| 24 | Two sources for HBAR units | **Fixed** (shared `TINYBAR_TO_WEIBAR`; `hbarScale` only in local mode). |
| 29 | Preview gave no reason | **Fixed.** `POST /tier` and `POST /preview` return `reasons`. |
| 31 | Schedule id for HashScan | **Fixed** (`scheduleId`, 0.0.x). |
| 33 | No guardian fact codes | **Fixed** (`facts`: never_paid, times_usual, own_device, nth_this_week). |
| new | Owner Stop / Freeze from the web page | **Fixed.** `POST /payments/:id/stop-request` and `POST /freeze-request` push to the puck, which shows the payment and asks for the PIN (firmware updated). |
| new | `usdc` missing from `/state` | **Fixed.** |
| PQ | Puck signatures were ECDSA only (forgeable by a large quantum computer) | **Added:** hybrid ECDSA + hash-based (WOTS/Merkle) signatures for every money-moving or settings action. See `docs/QUANTUM.md`. |

Tests after the pass: contracts 72, shared 13, backend 29, dashboard 37, guardian 3, firmware PQ vectors 4 (gcc, native), local end-to-end story ALL PASSED with the hash-based layer on.

## Findings (sorted by risk)

| # | Item | Result | Where | Risk if left | Smallest fix | Who |
|---|---|---|---|---|---|---|
| 21 | Routes need auth | **Different** | `server.ts:28` (`/device` is in OPEN_ROUTES), `server.ts:31` (`if (!cfg.apiToken) return true`), `config.ts:51` (token defaults to `""`), `server.ts:72` (every `POST /relay/*` is open) | With no `RELAYER_API_TOKEN`, every route is open: `/requests`, `/agent/chat`, `/labels`, `/fallback/execute`. `/device` never checks a token (`server.ts:110-114`), so anyone can connect as `role=puck`. That client then gets every payment request (`flows.ts:233`) and can send `rejected` for any waiting request (`flows.ts:273-283`, which checks only `d.role`). Nobody can steal money this way (the chain checks signatures), but anyone can block payments and can rename payees through `/labels`, which misleads the owner. | Refuse to start in testnet mode when `apiToken` is empty. Check the token on `/device`. Ignore an unsigned `rejected` (or have the puck sign it). | Backend |
| 13 | No single non-owner key gains the power to pay | OK (with one gap) | `Vault:418-423` (RECOVER_PUCK is proposed by a guardian), `Vault:451-453` (approver must be a different guardian), `Vault:485` | One guardian cannot replace the owner key: that needs two guardians and the recovery delay, and the owner can veto (`Vault:463-466`). The agent key can pay alone, but only to payees past probation and within `agentDailyMax` (`Vault:363-368`). | None for the contract. The pitch should say "two guardians plus a delay". | — |
| 16 | A freeze ends by itself; only a different key renews it | **Different** | `Vault:373-389` (only check is `_isFrozen()`), `Vault:397` (SameFreezer check exists only in `renewFreeze`) | When the freeze expires, the same key can call `freeze` again right away. Each freeze bumps `keyEpoch` (`Vault:381`), which kills every pending change (`Vault:745`), including the owner's `REMOVE_GUARDIAN` against that key. One rogue guardian or watcher can keep the vault frozen and avoid being removed, as long as `2*RECOVERY_DELAY > FREEZE_MAX` (could not tell: deploy values). Funds are locked, not stolen. | In `freeze`, add a cooldown for `lastFreezer`, or skip the `keyEpoch` bump for a pending `REMOVE_GUARDIAN` whose target is the freezer. | Contract |
| 2 | Nothing released on silence | OK | `Vault:286-288` (WAIT is PENDING, unconfirmed), `Vault:294-304` (`reconfirm` by puck after `confirmFrom`), `Vault:320` (`execute` requires `confirmed`) | WAIT needs a second puck signature after `coolOff/2`. If it is not given, the payment expires (`Vault:343-347`). Backend reminds the puck (`flows.ts:557-566`). | — | — |
| 4 | `execute` checks | OK | `Vault:317-322` + `_live` `Vault:789-794` | Checks pending, current epoch, not expired (`_live`), not frozen, confirmed, and `releaseAt` reached. | — | — |
| 5 | Stop sets status first and is final | OK | `_close` `Vault:571-588` (status at 572, before the `deleteSchedule` call at 583) | A stopped payment fails `_live` on later calls (`Vault:791`). | — | — |
| 10 | Status before transfer; non-reentrant | OK | `_release` `Vault:564-569`; `nonReentrant` on propose/reconfirm/approve/execute/veto/cancel/agentPay | There is also a reentrancy test ("blocks reentrancy from a malicious receiver"). | — | — |
| 1 | Three levels and their thresholds | OK | `tierFor` `Vault:491-502` | INSTANT: saved payee past `PROBATION`, `amount <= instantMax`, and 2-day instant total plus amount `<= dailyCap`. APPROVAL: new recipient with `amount*2 > spendable`, or over `waitMax`. Otherwise WAIT. Limits are per token and set through SET_LIMITS. | — | — |
| 7 | More than half the balance to a new recipient needs approval | OK (narrow) | `Vault:499` (`since == 0 && amount*2 > spendable`) | A payee still on probation (`since != 0`) who gets more than half the balance goes to WAIT, not APPROVAL. | Optional: use `!saved` instead of `since == 0`. | Contract |
| 6 | Midnight double-spend; waiting total given back | OK | `_window` `Vault:833-835` (today plus yesterday), `_close` `Vault:574-578` (subtracts from the `proposedAt` day) | — | — | — |
| 8 | Deadline at most about 600 s | OK (partial) | `MAX_DEADLINE=600` `Vault:85`, `_checkDeadline` `Vault:812-815` | Only propose, reconfirm, agentPay and proposeChange carry a deadline. Signatures for `approve`, `veto`, `cancel` and `freeze` never expire (`Vault:308,326,336,375`). A guardian approval signature captured off-chain stays valid for as long as that payment is live. | Add `deadline` to the APPROVE digest. | Contract and shared |
| 9 | Replay: nonce, vault, chain id, action in the digest | OK (partial) | `_digest` `Vault:796-798` (TAG, chainid, vault, action), `_useDigest` `Vault:807-810` | No nonce in approve/veto/cancel/freeze. They are one-shot per id or epoch by state, so a replay does no harm. | — | — |
| 3 | `scheduleCall` at 0x16b called directly | OK | `Vault:91`, `Vault:610-613` (`SCHEDULE_SERVICE.call`). No `delegatecall` in the file. | — | — | — |
| 11 | Gas reserve; cap on waiting payments | OK | `_pay` `Vault:625`, `_schedule` `Vault:604`, `MAX_PENDING=5` `Vault:84,284` | — | — | — |
| 12 | No owner, admin, upgrade or selfdestruct | OK | Imports `Vault:3-6` (no Ownable or proxy); grep finds no `selfdestruct` or `delegatecall` | — | — | — |
| 14 | Alarm light (watcher) can only stop and freeze | OK | veto `Vault:328`, freeze `Vault:377`, vetoChange `Vault:473`; approve needs GUARDIAN `Vault:310,450`; recovery needs GUARDIAN `Vault:420` | The watcher can also start the indefinite freeze loop described in #16. | See #16. | — |
| 15 | All keys differ; a guardian cannot be a payee | OK | `_addKey` `Vault:750`, `_addPayee` `Vault:755`, propose `Vault:254` | — | — | — |
| 17 | Delays that protect settings have no setter | OK | `immutable` `Vault:94-101` | `coolOff` is settable, with a floor of `MIN_COOLOFF` (`Vault:649`). | — | — |
| 18 | Which keys the server holds | OK | `config.ts:46` relayer (gas payer), `config.ts:48` agent; `index.ts:58` | The server holds no puck or guardian key. The simulator holds them (`sim/devices.ts:41-45`). That is a dev tool only, and it must never be part of the testnet demo story. | — | Backend |
| 22 | Server never calls `execute` on its own | OK | `flows.ts:493-499` is the only call to `execute`. It is reached only from `POST /fallback/execute/:id` (`server.ts:233`), requires `confirmed`, and opens 30 s late or after ScheduleFailed. | Because of #21, if no token is set, anyone can trigger this fallback. That is harmless, because it releases only what was already confirmed. | — | — |
| 23 | Fix `v` and low-s; check the signer before spending gas | OK | `shared/src/digest.ts:193-202`, `sig.ts:29-40`, used in `flows.ts:375,383` | `finishSignature` returns `null` on the first exception instead of trying the next candidate (`sig.ts:35-36`). This is minor. | `continue` instead of `return null`. | Backend |
| 24 | One HBAR unit helper | **Different** | `config.ts:38` (`hbarScale` env), `indexer.ts:349`; separate `shared/src/units.ts:6,29` | There are two sources of truth. If `HBAR_SCALE` is set wrong, `/state` balances are off by 10^10 while the rest stays correct. | Use `TINYBAR_TO_WEIBAR` from shared in `indexer.ts`, and keep `hbarScale` only for local mode. | Backend |
| 26 | Input validation; no stack traces | OK (mostly) | `flows.ts:196-203`, `server.ts:51-55,80-84` | Address, token (HBAR/USDC) and amount > 0 are checked. Error bodies contain `err.message` only, but raw RPC revert text is passed through as 422 (`flows.ts:152`). | — | — |
| 27 | Guardian alerts cannot be forged or silenced | OK | `clear` comes only from indexed chain state (`flows.ts:571-576`). Devices cannot send it. | Because of #21, a fake `guardian` device can still receive all alerts, which leaks privacy. | Token on `/device`. | Backend |
| 28 | Agent limited by the contract; one open request | OK | Contract `Vault:363-368`; refusals in `agent/core.ts:210-217`; one open request per source `flows.ts:204` | The text-based checks (`core.ts:244`) are UX only. The real limit is on-chain. | — | — |
| 25 | Mirror node with a cursor | OK | `chain/events.ts:65-86` (`timestamp=gt:` and `links.next`); `getLogs` only in local mode (`events.ts:110`, chosen at `index.ts:41`) | — | — | — |
| 19 | Secrets from env; `.env` ignored; nothing committed | OK | `.gitignore` lists `.env`; `.env.example` keys are empty; `git log --all -- .env` is empty | — | — | — |
| 20 | Testnet only | OK | `config.ts:41` (chain 296); `shared/src/hedera.ts:3`; grep finds no mainnet URLs | — | — | — |
| 29 | Preview with level and reason | **Different** | `server.ts:204` returns `{tier}` only (`flows.ts:173-176`) | The UI cannot show a reason without guessing. Judges would see a level with no "why". | Return `reasons[]` (patch B). | Backend |
| 30 | Payment states | **Different** | `shared/src/api.ts:11` (`status` is PENDING, EXECUTED and so on, plus `confirmed`, `tier`, `confirmFrom`) | The states `waiting_confirm`, `confirm_now`, `scheduled` and `needs_approval` must be derived in the adapter from `tier`, `confirmed`, `confirmFrom` and `schedule`. There is no `failed` state, and no `finishedBy` (only `executedBy`). | Derive in the adapter, or add `phase` (patch C). | Frontend / Backend |
| 31 | Ids for proof links | OK (partial) | `api.ts:18` (`schedule` address), `api.ts:21` (`txs`); `topicId` in `/state`, `/health` | `schedule` is an EVM address, not a `0.0.x` schedule id, so a HashScan `/schedule/` link needs a conversion. | Add `scheduleId` via `evmAddressToEntityId`. | Backend |
| 32 | Live channel | OK | WebSocket `/live` `server.ts:98-108`; kinds `api.ts:119-125` | It sends extra kinds `hcs` and `request`. | — | — |
| 33 | Guardian fact codes | **Missing** | `flows.ts:546` (alert has only `newRecipient`); facts are free text in `agent/core.ts:87-95` | The guardian page cannot show `never_paid`, `times_usual`, `own_device` or `nth_this_week` without computing them itself. | Add a `facts` array to `alertMsg` (patch D). | Backend |

## Proposed patches (not applied)

**A. Require a token in testnet mode and on `/device` (#21, #27)**
```diff
--- backend/src/config.ts
+  apiToken: process.env.RELAYER_API_TOKEN ?? "",
+};
+if (config.mode === "testnet" && !config.apiToken) throw new Error("RELAYER_API_TOKEN is required on testnet");
--- backend/src/server.ts
-const OPEN_ROUTES = new Set(["/health", "/device", "/live", "/api/v1/contracts/call"]);
+const OPEN_ROUTES = new Set(["/health", "/live", "/api/v1/contracts/call"]); // /live checks its own token
   f.get("/device", { websocket: true }, (socket, req) => {
+    if (!tokenOk(cfg, bearer(req))) { socket.close(4401, "unauthorized"); return; }
--- backend/src/flows.ts  (case "rejected")
-        if (d.role !== "puck") return;
+        if (d.role !== "puck" || !d.address || getAddress(d.address) !== getAddress(this.idx.roles.puck)) return;
```
Better still, make the puck sign the rejection, the same way `onPuckSigned` checks its signature.

**B. Preview with reasons (#29)**
```diff
--- backend/src/flows.ts
-  async tierPreview(to, token, amount): Promise<string> {
-    const t = await this.vault.read.tierFor(to, token, amount);
-    return TIER_NAMES[Number(t)];
+  async tierPreview(to: string, token: string, amount: bigint) {
+    const t = TIER_NAMES[Number(await this.vault.read.tierFor(to, token, amount))];
+    const s = this.idx.state!; const lim = token === this.cfg.usdc ? s.limits.usdc : s.limits.hbar;
+    const p = s.payees.find((x) => x.address === getAddress(to));
+    const reasons: string[] = [];
+    if (!p) reasons.push("new_recipient");
+    else if (now() < p.since + s.immutables.probation) reasons.push("payee_on_probation");
+    if (amount > BigInt(lim.instantMax)) reasons.push("over_instant_limit");
+    if (amount > BigInt(lim.waitMax)) reasons.push("over_wait_limit");
+    const bal = BigInt(token === this.cfg.usdc ? s.balances.usdc : s.balances.hbar);
+    if (!p && amount * 2n > bal) reasons.push("more_than_half_balance");
+    return { tier: t, reasons, releaseAfterSeconds: t === "INSTANT" ? 0 : s.coolOff };
   }
```
`over_daily_cap` needs `windows(token)` (`Vault:513`). Add it to `/state` as `usedToday`.

**C. `/state` additions and a derived phase (#30)**
```diff
--- backend/src/indexer.ts (refreshState, ~349)
+      usdc: this.cfg.usdc,
+      usedToday: { hbar: await windows(HBAR), usdc: await windows(this.cfg.usdc) },
+      frozenBy: this.lastFreezer ?? null,
--- shared/src/api.ts
+  usdc?: string; usedToday?: {...}; frozenBy?: string | null;
+  // PaymentView
+  phase?: "waiting_confirm" | "confirm_now" | "scheduled" | "needs_approval";
+  scheduleId?: string | null;
```
The phase rule: if PENDING and WAIT and not confirmed, the phase is `confirm_now` when `now >= confirmFrom`, else `waiting_confirm`. If APPROVAL and not confirmed, it is `needs_approval`. If confirmed, it is `scheduled`.

**D. Guardian fact codes (#33)**
```diff
--- backend/src/flows.ts alertMsg (~546)
-    return { t: "alert", ..., newRecipient: p.newRecipient };
+    return { t: "alert", ..., newRecipient: p.newRecipient, facts: this.facts(p) };
+  // facts(): never_paid = no EXECUTED to p.to; times_usual = amount / median of past payments to p.to;
+  // nth_this_week = count of proposals in the last 7 days. Use only indexed chain data, never message text.
```

**E. Contract: stop the same key freezing again forever (#16)**
```diff
--- contracts/contracts/HisnVault.sol freeze()
     if (r != Role.PUCK && r != Role.GUARDIAN && r != Role.WATCHER) revert NotAllowed();
+    if (s == lastFreezer && r != Role.PUCK && block.timestamp < uint256(frozenUntil) + FREEZE_MAX) revert SameFreezer();
```
Because the contract has no upgrade path (#12), this needs a redeploy. Add a test: "watcher cannot re-freeze within FREEZE_MAX after its own freeze ends".

**F. Approve signature expiry (#8)**: add `deadline` to the A_APPROVE digest (`Vault:308`) and to `shared/src/digest.ts`, and update `test-vectors.json`. This also needs a redeploy.

## API gaps for the frontend

| Frontend expects (`handoff/design`) | Backend has | Action |
|---|---|---|
| `POST /preview` returns `{level, reasons, releaseAfterSeconds}` | `POST` at `server.ts:202-205` returns `{tier}` only | Map tier to lowercase. Reasons are missing (patch B). Mark them "estimated" until then. |
| `AccountState.balances: Money[]`, decimal strings | `{hbar, usdc}` in smallest units (`indexer.ts:349`) | Convert in the adapter: HBAR has 8 decimals, USDC has 6. |
| USDC token address (`state.usdc`) | Not in `/state` | One-line fix in patch C. Until then, use `VITE_USDC_ADDRESS`. |
| `usedToday` | Not in `/state`, though the contract has `windows()` (`Vault:513`) | Patch C. |
| `locked.{settingsDelay, recoveryDelay, minCoolOff}` | Check `state.immutables` (it has `probation`, `core.ts:216`). Could not tell if all three are present. | Verify in the adapter. |
| `frozenBy` | Missing (the contract stores `lastFreezer`) | Patch C. |
| `PaymentState` (`waiting_confirm`, `confirm_now`, `scheduled`, `needs_approval`, `failed`) | `status`, `tier`, `confirmed`, `confirmFrom` | Derive (patch C rule). `failed` exists only on requests (`RequestView`). |
| `Payment.reasons`, `source`, `finishedBy` | No reasons. Source exists only on requests. `executedBy` is an address. | Join `/requests` by `paymentId`. Map `executedBy`: vault or schedule means "network", the relayer means "manual". |
| `proof.transactionId`, `scheduleId`, `topicId` | `txs.*` (EVM hashes), `schedule` (address), `topicId` in state | Convert the schedule address to `0.0.x`. |
| Owner stop | `POST /relay/cancel` needs a puck signature. The puck can also send `cancel` over `/device` (`flows.ts:291`). | There is no dashboard-only stop, which is correct. The UI should say "confirm on the puck". |
| `retryPayment(id)` | No such route | Treat it as a new request. |
| `guardianFacts(id)` and `FactCode` | Missing (patch D) | Keep the mock and label it. |
| `guardianWaiting()` and `guardianRegister()` | Device hub alerts only; no register route | Read from the mirror node in the guardian build. |
| `/live` kinds `payment`, `change`, `state`, `device` | Same, plus `hcs` and `request` | Ignore or use the extra kinds. |
| Token header | `Authorization: Bearer` or `?token=` (`server.ts:39-43`) | Use the Bearer header. |

## What we should stop claiming in the pitch if these are not fixed

- **"Only the owner's devices can talk to the server" or "the server is locked down."** Not true while `/device` is unauthenticated and the token is optional (#21). The safe claim is that the chain rejects anything not signed by the right key.
- **"A single guardian can only pause you briefly."** One guardian or alarm-light key can re-freeze after each expiry and block its own removal (#16). Say "a freeze ends by itself; a different key must renew it" only after patch E.
- **"Every signature expires in 10 minutes."** This is true only for owner and agent actions. Guardian approve, veto and freeze signatures never expire (#8).
- **"The guardian sees why a payment is suspicious (never paid, 5x usual…)."** There are no fact codes yet (#33). Show only "new recipient" and the amount.
- **"Send shows you exactly why a payment waits."** Preview returns only the level (#29).
- Safe to keep: no release on silence (#2), two guardians plus a delay to replace the owner key (#13), no admin or upgrade path (#12), the network timer called directly (#3), and the server holds no owner or guardian key (#18).

## Gaps found while wiring the redesigned frontend

| Need | Today | Smallest fix | Who |
|---|---|---|---|
| Owner "Stop payment" from the web page | No route asks the puck to sign a cancel. The puck posts `/relay/cancel` on its own, and only the simulator exposes `/puck/cancel/:id`. The page can only say "Press Stop on your puck". | Add `POST /payments/:id/stop-request`. It pushes a `cancel_request` to the puck over `/device`, the same way `/requests` pushes payment requests. The puck shows it and signs `CANCEL`. | Backend + firmware |
| Token address in `/state` | The dashboard falls back to `VITE_USDC_ADDRESS` or guesses from the payments it sees. | Add `usdc: this.cfg.usdc` to `refreshState` (`indexer.ts` ~349) and `usdc?: string` to `StateView`. | Backend |
| Owner "Freeze" from the web page | Same as stop: only devices can freeze. The page tells the owner to hold Freeze on the puck. | Optional: a `freeze_request` pushed to the puck. | Backend + firmware |
