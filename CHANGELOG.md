# Changelog

## 0.7.1 — 2026-09-02

### Changed
- Setting up an unmatched import account starts “What you call it” as the Monarch name. You can keep it, edit it, or copy the Monarch name back in with one click.

## 0.7.0 — 2026-09-02

### Added
- A full JSON backup can carry the encrypted expenses vault. Restore it on another device and unlock with the same key. Backups without expense tracking stay plan-only, as before.

## 0.6.0 — 2026-08-24

### Changed
- The Vacation pot takes the household savings sweep every month. Vacation-tagged spend (a prepayment or a trip) comes out on the day it posts. The warning is a balance that would go below zero — the sweep is no longer paused in a “travel month.”

## 0.5.7 — 2026-08-24

### Added
- Closing a month keeps that month’s typical-month spend. The Budget tab charts those chosen totals beside what actually posted, so you can see how the plan has moved.

## 0.5.6 — 2026-08-24

### Added
- Ask a question walkthroughs for every Expenses tab: Month end, Budget, Forecast, Reimbursable, Transactions, Import, and Accounts.

## 0.5.5 — 2026-08-24

### Fixed
- Ask a question can walk through the Month end checklist (tidy, reimbursements, closing balances, savings, reconcile).

## 0.5.4 — 2026-08-24

### Added
- Ask a question can walk through using Tidewater (import, goals, Expenses, Forecast, Reimbursable), not only the numbers.

## 0.5.3 — 2026-08-24

### Fixed
- Ask a question can see Reimbursable-tab actuals by bucket and month, so that section is not only a held-out footnote on the Budget tab.

## 0.5.2 — 2026-08-24

### Fixed
- Ask a question can see Forecast lookback spend by category and month, so a historical question is not limited to the period on the Budget tab.

## 0.5.1 — 2026-08-24

### Fixed
- Ask a question is available from the expenses screen header, so chat is not trapped behind that overlay.

## 0.5.0 — 2026-08-24

### Added
- Ask a question can use a compact spending and forecast snapshot while expense tracking is unlocked (plan vs actual, household vs vacation, overlay vs calendar vs typical-month plan). Locked and public builds stay plan-only. The vault and ledger never go to chat.

### Changed
- Help and cloud acknowledgement no longer claim chat can analyze spending patterns. Cloud still sends a compact summary, not the vault.

## 0.4.4 — 2026-08-24

### Added
- Future month cards list what makes up the Forecast column (every-month lines, then seasonal and annual that land that month, then pins), and a collapsed remainder list for what is still in the overlay.

## 0.4.3 — 2026-08-24

### Added
- Forecast category cards can override type, and typical months when the line is seasonal or annual, so a cost like gas can sit on the calendar without pinning it on top of the plan.

## 0.4.2 — 2026-08-24

### Changed
- Current-month forecast finishes established irregular lines toward “when it is present” once they have posted this month, and lists those leftovers on the month card.

## 0.4.1 — 2026-08-24

### Changed
- Reimbursable matching is the whole family: `Reimbursable: Healthcare Account` (and similar) is enough. The generic parent tag is no longer required, and leftover parent-only rows show up in month-end tidy.

## 0.4.0 — 2026-08-24

### Added
- Forecast tab (inside unlocked expense tracking): household goal coverage at a 9-of-10 bar, sealed monthly snapshots, and last-month variance with a reconstructed label when no snapshot was stored

## 0.3.4 — 2026-07-30

### Fixed
- Transaction import review appears immediately on the welcome screen (it used to wait until a budget was already open)

## 0.3.3 — 2026-07-30

### Added
- Progress bar while importing large files (reading, then averaging Monarch transactions)

## 0.3.2 — 2026-07-30

### Added
- Desktop / home-screen icon set (PNG + Apple touch icon + macOS `.icns`)
- Installable Mac app at `dist-native/Tidewater.app` (`npm run app:mac`) — opens the live PWA in an app window
- Stronger PWA manifest for installing Tidewater on Mac and iPad

## 0.3.1 — 2026-07-29

### Added
- **Restore a full backup** under Your data (JSON), so export and restore sit together; welcome Import also accepts `.json`

## v0.3.0 — 2026-07-29

- CR-16: Add a help feature

Versions follow [semver](https://semver.org): **MAJOR.MINOR.PATCH**.
Release notes start here — earlier work lived in the initial 0.1.0 commit without a changelog.

## 0.2.4 — 2026-07-29

### Added
- Help button in the header and a dedicated Help modal with guidance on budget setup, expense sliders, goals, CSV/Monarch importing, chat assistant, and data privacy

## 0.2.3 — 2026-07-29

### Added
- Chat history is kept on this device (IndexedDB) and restored when you reopen the assistant; **Clear** removes it, and **Erase my data** clears it with the budget

## 0.2.2 — 2026-07-29

### Fixed
- A blank-looking page after a hard reload: if the browser's storage does not answer, Tidewater now opens anyway after a few seconds and says that nothing will be saved, instead of waiting forever on “Opening your budget…”

## 0.2.1 — 2026-07-29

### Added
- Version number after the Tidewater name; tap or click it to read this changelog

## 0.2.0 — 2026-07-29

### Added
- Custom goals via **Something else**: name the goal, then add it to the list
- Version tracking (`package.json`, `CHANGELOG.md`, shown under Your data)

### Fixed / improved (carried from 0.1.x work)
- Per-goal time scales (1 / 5 / 10 / 25 / 35 years), two cards side-by-side
- Stable expense slider baselines and whole-dollar amount entry (no leading-zero glitch)
- Goal contribution/rate steppers with direct entry
- Recommended Anthropic models with relative cost guidance
