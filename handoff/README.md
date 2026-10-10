# Hisn design handoff

The design brief the dashboard, the guardian page and the mobile app were built from.

| Path | What it is |
|---|---|
| `design/DESIGN.md` | Colours, type, spacing, components, wording rules. **The style source of truth.** |
| `design/tokens.css` | The same colours and sizes as CSS variables. |
| `design/SCREENS.md` | Every screen: what it shows, its states, what data it needs, what each button does. |
| `design/API_EXPECTED.md` + `types.ts` | The API the screens expect. |
| `design/mock.json` | Sample data so the UI works before the backend is wired. |
| `design/REVIEW_CHECKLIST.md` | Review points for the backend and the contract. |
| `design/logo/` | Logo mark, lockup and favicon as SVG. |
| `design/reference/*.html` | One static HTML file per screen, in the final colours. |

## Things to know

- **Colours:** navy and royal blue (colour set 1).
- **Font:** Figtree (Google Fonts).
- **Rules follow version 2 of the design:** nothing leaves on silence; the owner confirms a waiting payment a second time; the guardian has no "It looks fine" button for waiting payments. `SCREENS.md` wins over the reference HTML if they disagree.
- **Amounts are shown as USDC.** Switching to plain dollars is one setting (`DESIGN.md`, "Money").
- Names, addresses, dates and amounts in the mock data are samples.
