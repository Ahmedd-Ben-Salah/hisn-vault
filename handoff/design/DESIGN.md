# Hisn design system

Style: a friendly, serious bank. White background, very large bold numbers, pill-shaped buttons, round avatars, soft tinted panels. One accent colour. No gradients, no shadows, no glass effects, no emoji.

Tokens are in `tokens.css`. Use the variable names below, never raw hex.

## Colour use

| Use | Token |
|---|---|
| Text, dark buttons, avatars, progress fill | `--ink` |
| Secondary text | `--muted` |
| Primary action (Send, Continue) | `--accent` with `--on-accent` text |
| Quiet buttons, active nav pill, neutral avatars, info panels | `--soft` |
| Card border, list dividers | `--line` |
| Inputs, chips | `--border` (focused input: 2 px `--ink`) |
| Waiting | panel `--wait-bg`, track `--wait-track`, label text `--wait-fg`, body text `--wait-text` |
| Stop, stopped, freeze | button `--stop` with white text; text `--stop-fg`; panel `--stop-bg` with `--stop-text` |
| Received, "can", online | `--ok-fg`, `--ok-bg`, dot `--online` |

The accent appears in few places: the primary button, the small block in the logo, hovered links. Everything else is ink on white.

## Type

Figtree only. Weights: 900 for the balance and page titles, 800 for headings and buttons, 700 for names and amounts, 600 for labels, 400 to 500 for body.

| Role | Size | Notes |
|---|---|---|
| Balance (desktop home) | 68 px / 900 | letter-spacing -2.5 px; the unit ("USDC") at 30 px |
| Page title | 44 px / 900 | letter-spacing -1.5 px, line-height 1.05 |
| Section title | 22 px / 800 | |
| Card title | 18 px / 800 | |
| Body | 16 to 17 px | |
| Secondary | 14 px, `--muted` | |
| Phone | balance 52 px, page title 28 px, amounts up to 76 px on Send | |

Numbers always show two decimals. Use tabular figures where amounts line up in a column.

## Layout

- Desktop: top bar 72 px (logo left, nav pills centred, "Testnet" chip and avatar right), then a centred column of 1140 px. Most pages are a wide column plus a 380 to 400 px side column with a 48 px gap.
- Phone (under 768 px): single column, 20 px side padding, bottom tab bar with the same five destinations. No fake status bar.
- Cards: 1.5 px `--line` border, radius 28 px, padding 24 px. Tinted panels have no border.
- Vertical rhythm: 16 to 26 px between blocks.

## Components

Build each as one small file. Sizes are desktop; phone values in brackets.

| Component | Spec |
|---|---|
| `Button` | Pill. Heights 54 (primary, large), 46 (medium), 42 (filter). Variants: `primary` (accent), `dark` (ink), `quiet` (soft), `outline` (2 px ink), `stop` (stop red, white text), `stop-outline`. Weight 800, 17 px. [phone primary 62 to 72 high, full width] |
| `NavPills` | 16 px / 700 links, padding 10 x 18, active has `--soft` background, others `--muted`. |
| `Avatar` | Circle with one initial. Sizes 40, 46, 54, 76. Neutral: `--soft` / `--ink`. Dark: `--ink` / white. Waiting, stopped and received tints from the status tokens. |
| `StatusChip` | Pill, 13 to 14 px / 800. Waiting: `--wait-bg` / `--wait-fg`. Others follow the status tokens. Always a word. |
| `Progress` | Track 8 to 12 px high, fully rounded, fill `--ink`. On a waiting panel the track is `--wait-track`. Shows a start and end time above it, never a ticking seconds counter. |
| `WaitingBanner` | `--wait-bg` panel, radius 28, a 60 px dark circle with a clock icon, title 24 px / 800, one line of detail, progress, then Stop and Details buttons. |
| `ListRow` | Avatar, name (17 / 700) over detail (14, muted), right-aligned amount (17 / 800) over status (14 / 600, coloured by status). 1 px `--line` divider on top. The whole row is a link. |
| `Card` | See Layout. Title 18 / 800. Key-value rows: label muted on the left, value 700 on the right. |
| `RuleCard` | Tinted panel: small caps label (14 / 800), big title (30 / 900), one sentence, a usage bar, a text link. Tints: ok, wait, stop. |
| `Timeline` | Vertical. 18 px dot with a 3 px ring, 3 px connector. Done: ink. Current: amber fill with ink ring. Future: white fill with `--border` ring, muted text. Title 17 / 800, one muted line, time on the right. |
| `AddressText` | First 8 and last 8 characters. The first and last groups sit on a `--soft` chip so the eye lands on them. Click to expand and copy. |
| `Field` | Label 14 / 700 muted above; input height 60 (84 for the amount), radius 16 to 20, 2 px ink border, text 17 / 600 (amount 44 / 900). |
| `ChatBubble` | User: ink background, white text, radius 22 with a small bottom-right corner. Helper: `--soft`. Helper refusal: `--wait-bg`. |

Icons: simple 2 px stroke line icons (clock, lock, plus, search, arrow). Use one icon set consistently, for example Lucide.

## Logo

`logo/hisn-mark.svg`: an H whose right leg is lifted off the ground, with a small accent block under it (the payment waiting to pass). Use the mark at 28 to 32 px next to the wordmark "hisn" in Figtree 900, 26 px, lowercase. On dark backgrounds the mark is white with the accent block unchanged. Keep clear space of half the mark's width.

## Money

Amounts are shown as `100.00 USDC`. If the team switches to dollars, change one formatter (`formatMoney`) to output `$100.00` and show the token name only on the payment detail page. HBAR is always shown as HBAR.

## Wording

Plain words a grandparent can read. Short sentences.

| Say | Never say |
|---|---|
| Waiting, leaves at 16:42 | Pending, queued, scheduled tx |
| Stop payment | Veto, cancel transaction |
| New recipient | Unknown address, unverified |
| Saved name | Verified, trusted |
| Guardian | Co-signer, approver |
| Confirm again | Re-sign, reconfirm transaction |
| Our server cannot move or block your money | No company in the middle |
| Slows the payment and adds a second check | Protects you from scams |

Fixed sentences that must appear:

- Wherever a payment can be stopped: "Stopping is always safe. The money stays in your account."
- On a new-recipient review: "Hisn never asks you to move money to keep it safe."
- On the guardian alert: "Call her on her usual number. Hisn never calls you."
- After a stop: "Nobody can recover money for a fee."

## Accessibility

Text contrast at least 4.5:1. The token pairs were chosen with that in mind but not measured; run a contrast check once in Phase 2. Visible focus ring: 3 px `--accent` outline with 2 px offset. Every icon-only button has a label. Nothing relies on hover. Respect reduced-motion: no animation is required anywhere.
