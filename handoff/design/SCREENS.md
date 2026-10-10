# Hisn screens

For each screen: purpose, layout, content, states, data, actions. Reference HTML is in `reference/`; this file wins if they disagree. Data shapes are in `types.ts`; API calls are in `API_EXPECTED.md`.

Routes: `/` home, `/send`, `/payments`, `/payments/:id`, `/people`, `/protection`, `/helper`. The guardian page is a separate build at its own origin.

Shared: top bar on every owner page (logo, nav pills: Home, Payments, People, Protection, Helper; "Testnet" chip; avatar). On phones the nav becomes a bottom tab bar.

---

## 1. Send money (`/send`) · reference `send.html`, `m-send.html`

**Purpose:** start a payment and tell the owner, before she confirms, what will happen to it.

**Layout:** left column form, right column summary (380 px). Phone: one column, amount centred and very large.

**Content, left:**

1. Title "Send money".
2. "Who to?": saved people as pill buttons (avatar + name). Below: a field "Or paste a new address". When the address is not a saved payee, a "New recipient" chip appears inside the field.
3. "How much?": large amount field with a token selector (USDC, HBAR). Under it: "You have 150.00 USDC. After this payment: 50.00."
4. A rule panel that updates live as she types (see states).
5. Buttons: primary "Continue on your puck", quiet "Cancel".

**Content, right:** card "Before you confirm" (To, Amount, Network fee, Leaves, Guardian); card "Which rule applies" (three rows, the active one highlighted); soft panel "Check the address on your puck. Its screen shows what you are really signing. If it differs from this page, press No."

**States of the rule panel** (computed by the backend preview call, never by the frontend alone):

| Level | Panel | Text |
|---|---|---|
| Instant | soft | "This payment is sent right away." |
| Waits | waiting tint | "This payment will wait 3 minutes. You have not paid this address before. Sami will be alerted and can stop it. You will be asked to confirm it once more." |
| Needs approval | stop tint | "This payment needs Sami's approval. Nothing leaves until he says yes." Also shown when the amount is more than half the balance to a new recipient, with: "Hisn never asks you to move money to keep it safe." |
| Blocked | stop tint | Frozen account, over limits, or too many waiting payments: say which, and disable Continue. |

**After Continue:** a full-width step view "Check your puck": shows amount and address, a spinner-free waiting state ("Waiting for you to approve on your puck"), a Cancel link. On success go to the payment's detail page. On rejection or timeout (120 s) say so and return to the form with values kept.

**Data:** state (balances, payees, limits), `previewPayment`, `createRequest`, `getRequest` (poll or live).

---

## 2. Payment detail (`/payments/:id`) · reference `payment-detail.html`, `m-payment.html`

**Purpose:** show one payment's state, let the owner stop it, and show the proof.

**Layout:** left: status chip, title "100.00 USDC to a new recipient", one-line explanation, the action panel, then "What has happened" timeline. Right (400 px): Details card, Proof card, soft note.

**States** (this screen must handle all of them):

| State | Chip | Explanation line | Action panel |
|---|---|---|---|
| `waiting_confirm` (WAIT, not yet confirmed, before half the wait) | Waiting | "You will be asked to confirm again at 16:40." | Progress (signed → leaves), Stop payment |
| `confirm_now` (WAIT, confirm window open) | Confirm again | "Confirm once more on your puck to let it leave at 16:42." | "Check your puck" note, Stop payment |
| `scheduled` (confirmed, timer set) | Waiting | "Leaves by itself at 16:42, unless you or Sami stop it." | Progress, Stop payment |
| `needs_approval` (APPROVAL, not approved) | Needs approval | "Nothing leaves until Sami approves." | Stop payment |
| `executed` | Paid | "Sent at 16:42 by the Hedera network." | none; link "See the transaction" |
| `vetoed` | Stopped | "Stopped by Sami at 16:40. The money never left your account." | Stop panel text: "Nobody can recover money for a fee." |
| `cancelled` | Cancelled | "You cancelled this payment." | none |
| `expired` | Expired | "Not confirmed in time. Nothing was sent." | "Send again" link |
| `failed` | Problem | "The network could not deliver it." plus the reason | "Retry" button (calls manual execute), Stop payment |

The Stop panel always carries: "Stopping is always safe. The money stays in your account." Stop asks for one confirmation in place (the button turns into "Yes, stop it" for 5 seconds), then the owner approves on the puck.

**Timeline steps:** asked; approved on the puck; guardian alerted; confirmed again (WAIT only) or approved by guardian (APPROVAL only); leaves. Each has a time and one plain sentence. Future steps are muted.

**Details card:** To (AddressText, plus "New recipient. No saved name." or the saved name), Amount, Rule, Why, Guardian.

**Proof card:** links to HashScan: Transaction, Network timer (the schedule), Public record (the HCS topic). Hide a row if the backend gives no id for it.

**Data:** `getPayment`, `getTimeline`, live updates; `stopPayment`, `retryPayment`.

---

## 3. Guardian page (separate build) · reference `m-guardian.html`

**Purpose:** let the guardian see a waiting payment and stop it, even if the main server is down.

**Hosting and keys:** its own static site and origin. No third-party scripts. On first open it creates a key in the browser, shows the address and a QR code to register it, and stores it locally. It reads payments from the mirror node directly and also listens to the backend for speed. It decodes what it shows from chain data.

**Layout (phone first):**

1. Logo and a "Guardian" chip.
2. Owner avatar and one sentence: "Amel is sending money. Please check."
3. Waiting panel: amount, "to a new recipient" or the saved name, address, "Leaves at 16:42 unless you stop it", progress.
4. Three facts with dots: "She has never paid this address." / "It is twice what she usually sends." / "She approved it on her own puck." Facts come from the backend as fixed codes; the page maps codes to sentences.
5. Soft panel: "Call her on her usual number. Hisn never calls you. Ask: Who asked you to pay? Did anyone tell you to keep it secret? Have you met this person?"
6. Actions.

**Actions by payment level:**

| Level | Buttons |
|---|---|
| Waits | **Stop payment** (large), link "Freeze her whole account". No "looks fine" button: only her second confirmation releases it. |
| Needs approval | **Stop payment**, **Approve** (enabled only after ticking "I spoke to her on her usual number"), Freeze link. |

After Stop: "Stopped. Stopping is a pause, not an accusation. Nobody can recover money for a fee."

**Other states:** nothing waiting ("All quiet. You will be alerted here."); a settings change or puck recovery waiting (shows what changes, with Stop and, where allowed, Approve); account frozen (who froze it, when it ends, "Renew" if she is allowed); offline (says it cannot reach the network and keeps retrying).

**Sending:** sign and post to the backend first; if no answer in 5 s, send the transaction directly through the public RPC with the guardian's own key.

---

## 4. Home (`/`) · reference `home.html`, `m-home.html`

- "Total protected", the balance at display size, "plus 40.00 HBAR".
- Buttons: Send (primary), Add money, Freeze (quiet).
- If a payment is waiting: the WaitingBanner (title, "Leaves at 16:42 · address · Sami was notified at 16:39", progress, Stop payment, Details). If it needs her second confirmation, the title becomes "Confirm on your puck to let it leave". If several are waiting, show the most urgent and "and 1 more".
- "Recent payments": five ListRows and "See all".
- Side: guardian panel ("Sami is your guardian. He can stop a payment. He can never move your money."); card "How your money leaves" (Right away / After 3 minutes / Only if Sami approves) with an Edit link; a one-line device status.
- Frozen state: a stop-tinted banner replaces the waiting banner: "Your account is frozen until Tuesday 18:00. Nothing can leave."
- Empty state: no payments yet: "Nothing here yet. Send your first payment."

## 5. Payments (`/payments`) · reference `payments.html`

Title, Send button, filter pills (All, Waiting · n, Paid, Stopped), search field, rows grouped by day (Today, Yesterday, Earlier). Side: card "Since [date]" (Paid out, Waiting now, Stopped, Received); if any were stopped, a stop-tinted note describing the latest; link "Download a record of all payments". Filters and search work on the client.

## 6. People (`/people`) · reference `people.html`

Guardian panel (avatar, name, since when; four "Can / Cannot" lines; device status; "Change guardian"). "Saved people" grid of cards (avatar, name, short address, last paid, Send, Remove). A dashed "Add a person" row: "Sami has to agree, and it takes 48 hours." A newly added person shows a chip "Instant from [date]" during probation. Changes open a "Check your puck" step like Send.

## 7. Protection (`/protection`) · reference `protection.html`

Title, sentence, "Freeze account" (stop-outline). Three RuleCards (Right away / After 3 minutes / Only if Sami approves) with limits and today's usage. Below: "Locked for good" card (three fixed delays), "Devices" card (puck, guardian light, guardian phone with status and Replace), "Helper" panel with today's allowance. Waiting changes appear at the top as a banner with their own countdown and an "Apply" button when ready.

## 8. Helper (`/helper`) · reference `helper.html`, `m-helper.html`

Chat on the left: user bubbles, helper bubbles, refusal bubbles in the waiting tint with "Review it" and "Discard". Input pill with a round send button. Side: allowance panel (15 of 20 USDC, bar), "What it is allowed to do" (Can / Cannot), "Today" list. The page never claims the helper can do more than the allowance.

## Phone

The same routes, responsive. References: `m-home.html`, `m-send.html`, `m-payment.html`, `m-guardian.html`, `m-helper.html`. Primary buttons are full width and 62 to 72 px high and sit at the bottom of the screen.

## Loading, errors, live updates

- Loading: grey `--soft` blocks in the shape of the content. No spinners on whole pages.
- Errors: one plain sentence and a "Try again" button. Never show a raw error or a hex revert string; map known reasons (frozen, over limit, not a saved person, too many waiting) to sentences and fall back to "Something went wrong. Nothing was sent."
- Live: payments update without a refresh. If the live connection drops, show a small "Reconnecting" chip in the top bar and fall back to polling every 5 s.
