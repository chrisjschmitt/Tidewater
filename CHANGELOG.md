# Changelog

## 0.13.4 — 2026-10-07

### Fixed
- "Remember for next time" now keeps the comment too — the transaction's and each split part's — and writes it on matching TD rows from then on (never over a comment already there).

### Changed
- Taught rules in Settings read as a sentence: which bank text (and amount) they match, the merchant name, the category or the split with its percentages or amounts, tags and comments.

## 0.13.3 — 2026-10-07

### Changed
- Each part of a split is back on one line in the editor — amount, category, tags and a short comment — in a wider Edit window.

## 0.13.2 — 2026-10-07

### Changed
- Tags are picked, not typed: chips with × to remove and an "Add tag…" list of existing tags (or "New tag…"), in Edit and in "Add a transaction".
- Category is a list of existing categories (or "New category…"), in Edit and in "Add a transaction".
- A split can be entered by % as well as by amount; percentages must add up to 100%, rounding goes to the last part, and each part's amount is shown as you type.
- Each part of a split can have its own comment.
- Split rows are marked "Split 1 of 2", "Split 2 of 2" in Transactions, and "Split in 2" on the Review tab.

## 0.13.1 — 2026-10-07

### Added
- Transactions: an Edit button on every TD and manually entered row opens one form for merchant, comment, category, tags and split. Saved into the day's review session (one Undo under Past imports).
- A comment on any TD transaction (in Edit, or Change… on the Review tab), shown under the row.
- Transactions: a "Budget so far" running total and a "Budget spend" total that count exactly what the Budget tab counts — no transfers or card payments, nothing held as reimbursable, no income, no excluded accounts — so the newest row matches the Budget tab's spent for the same period and filters.

### Changed
- "Add cash spending" is now "Add a transaction": any account (a card no file covers, say), with a comment. Rows are marked TD or Manual in the list.

## 0.13.0 — 2026-10-07

### Added
- Settings → "Switch-over from Monarch": one date for every account with a TD feed, or a date per account. From it, the account's totals come from its TD rows and Monarch's rows are kept for comparison only. Each TD account shows how often it agrees with Monarch and how many rows still need a look, and is marked "looks ready" at 85% agreement with nothing left to look at. Clear or change the date at any time; nothing is moved or deleted.

### Changed
- A purchase the two feeds date on opposite sides of the switch-over counts once, by TD's date.
- Accounts with no TD feed (a card from another bank) stay on Monarch after a switch-over, until their purchases are entered by hand.
- After the switch-over, Month end's Tidy step points to the Review tab, and the Monarch import says its later rows are for comparison only.

## 0.12.0 — 2026-10-07

### Added
- A Review tab for TD transactions, by month: what needs a look, what the rules settled, and what you have confirmed. Accept a suggestion in one click, or change a row's category, tags and split amounts together in one form (the split must add up), optionally remembering it for that merchant or that exact amount. "Confirm the settled rows" accepts everything the rules were sure of. Confirmed rows are never touched by the rules again and teach them like Monarch rows; a day's changes are one Undo under Past imports.
- Family trips in Settings → Rules: a date range, the family accounts, and the trip tag. Spending in the range gets the tag — except the categories you list (restaurants and groceries by default), merchants you use regularly, and anything already in a reimbursable bucket — and chosen categories can be re-filed during a trip (fuel for a rental car, say).
- Rules vs Monarch lists the TD rows Monarch has nothing for, and can show (and un-leave) the rows you left.

### Fixed
- A merchant Tidewater has never seen is named in plain case rather than in the bank's capitals.

## 0.11.1 — 2026-10-07

### Fixed
- Two deposits with the same bank text on the same day, filed by amount (one pension per person), are now told apart by their amounts instead of being mistaken for a split. A familiar amount is not flagged as unusual.
- "Teach" now visibly works: a taught rule outranks anything learned, the merchant's TD rows are re-filed at once (one undoable batch), and the row shows "Taught ✓". "This amount" teaches a rule for that exact amount only.

### Changed
- An e-transfer of a familiar amount is offered as the first suggestion rather than filed automatically.

## 0.11.0 — 2026-10-07

### Added
- A rules engine categorizes TD transactions as they come in: merchant, category, tags and any recurring split, in one step. It learns afresh from the Monarch history already in Tidewater (and from TD rows you confirm), weighting recent months more, so a change of habit shows within a few months. Card payments, transfers to your own accounts and dividend accounts are recognised from the bank text; anything history is unsure of goes to review with up to three suggestions.
- Import → "Rules vs Monarch": how the rules filed each TD row beside how Monarch filed the same purchase, by account and month, with each disagreement offering "Teach" (file this merchant the way Monarch did from now on) or "Leave". "Re-apply rules" runs the current rules over TD rows not yet confirmed, as one batch you can undo from Past imports.
- Settings → "Rules for TD transactions": merged categories, retired tags, dividend accounts, merchants to always check, and the rules you have taught.

## 0.10.7 — 2026-10-07

### Changed
- Forecast shows a month's pins right under "Plan vs forecast by category", as "Pinned on <month>" with Remove and notes, instead of further down the card — for future months too. A pinned category carries a "Pinned" badge in its row that jumps to the list.

## 0.10.6 — 2026-10-07

### Added
- In Forecast's "Plan vs forecast by category", click a Plan figure to change that category's plan from that month on. Earlier months keep the plan they had — on the Forecast, Budget and Month end tabs — and the budget (dashboard and sliders) carries the new amount going forward. A pin on the month still adds on top and is shown beside the figure.

### Changed
- Forecast no longer shows "What this forecast is": its one extra figure, each category's spend so far, is now an "Actual to today" column in "Plan vs forecast by category" for the current month. "This month" in the Forecast menu goes to that table.
- The Import tab labels its second section "Monarch export", beside "TD statements".

## 0.10.5 — 2026-10-07

### Changed
- "Download from TD" and reading the TD file moved to the Import tab, as a "TD statements" box above the Monarch import. One read brings in the TD rows and records the closing balances for the month you pick there (this month by default, or last month). Month end's Closing balances step still shows every account's balance for the month, with Record for a figure entered by hand, and points to Import for the file.

## 0.10.4 — 2026-10-07

### Fixed
- Closing balances now carries a balance forward when an account had no transactions in the month. If an account's newest row predates the month but the file was downloaded within it, the balance is recorded for the month as of the download day. An account missing from the TD file altogether (TD exports nothing for an account with no transactions) is offered its last recorded balance. Both are marked "Carried forward" in the review.

## 0.10.3 — 2026-10-07

### Added
- The Closing balances box takes a dropped file: drag the TD-transactions file from Finder onto it instead of steering a file dialog to the right folder. The downloader (0.2.1) now opens Finder with that file selected when a run finishes.

### Fixed
- Reading the combined TD file now says when an account was not recorded because no account here has its last four digits — both on the account's own row and as a list of what in the file went unmatched.
- A card statement whose rows all fall on one day now closes on the right row too: the running balances, not just the dates, decide which way the file runs.

## 0.10.2 — 2026-10-07

### Fixed
- A card's closing balance read from TD could be a few rows out of date. Card exports list the newest row first, and when several rows share the last day the oldest of them was taken. The newest one is now used, as it always was for bank accounts.

## 0.10.1 — 2026-10-07

### Fixed
- "Download from TD" now shows on a Mac in Safari too, not only in Chrome. Safari cannot watch the statement folder, so the run is followed in Terminal; when it says "Combined file ready", choose that one TD-transactions file with "Choose the statement files". Chrome still ticks each account off as it arrives.

## 0.10.0 — 2026-10-07

### Added
- The TD downloader (now 0.2.0) writes one combined file, `TD-transactions-<date>.csv`, with an Account column, and moves each account's own export into `raw/`. Progress prints one line per account as each file is saved, and the run ends with a "Combined file ready" line and a Mac notification.
- On the Mac that has the downloader, Closing balances offers "Download from TD": it opens the "Tidewater TD Download" Shortcut (bank Chrome window, you log in, the download runs in Terminal) and ticks each account off as its file arrives, then offers to read the combined file.
- Reading the combined file records the closing balances as before and can also bring in the TD transactions themselves. Until the switch-over from Monarch, they are kept beside Monarch's rows for comparison and do not count in any total. Reading the same file again adds nothing.

### Changed
- Expense tracking can now hold rows from two feeds: Monarch and TD. Which one counts for an account is decided by a switch-over date, not set anywhere yet, so every total is exactly what it was.

## 0.9.1 — 2026-09-18

### Added
- On an iPad — or any browser that cannot hold on to a folder — the Closing balances step offers "Choose the statement files" instead: select all the downloads together in one dialog and get the same review, the same matching by last four digits, and the same confirm. Nothing about the desktop folder read changes.

## 0.9.0 — 2026-09-18

### Added
- Month end can read a whole folder of TD statement exports in one pass. Pick the folder once on the Closing balances step; every account is listed with what its file says — matched by the account's last four digits — and nothing is recorded until you confirm. The one-at-a-time flows stay as the manual override.
- A companion downloader (`td-downloader/`) attaches to a Chrome window you logged into by hand and collects each account's CSV export under a clean, dated name. It holds no credentials, runs only while you watch, stops and hands back if TD shows a login or a challenge, and a re-run the same day picks up where it left off.

### Fixed
- Reading the statement folder no longer fails on every file. The browser's file handles were being called detached from their entries, which Chrome refuses.

## 0.8.3 — 2026-09-03

### Fixed
- On iPad and iPhone, Settings no longer offers a folder to watch (Safari cannot list the files, and that picker was blocking Choose a CSV). Import’s Choose a CSV is a direct tap again.

## 0.8.2 — 2026-09-02

### Added
- Settings can watch a local folder you drop Monarch CSVs into. After you choose it, you see the folder name and how many CSVs are in it. A newer file is offered for the existing Import review. Nothing is written until you bring it in. After the next unlock, choose the same folder again to check.

### Fixed
- Choosing a folder now shows that folder on Settings. The earlier File System Access path could close the picker and never update the screen.

## 0.8.1 — 2026-09-02

### Changed
- The household timeline keeps actual beside forecast (plan beside forecast ahead). Each spend bar is stacked: household at the bottom, then each reimbursable bucket you count as household.

## 0.8.0 — 2026-09-02

### Changed
- Forecast is a reading page: household timeline first, then this month, last month’s snapshot, and categories. Jump links: Timeline, This month (spend so far vs forecast), Plan vs forecast, Risk, Last month, Categories. Lookback, household/vacation tags, and erase expense data moved to a Settings tab in Expenses.

### Added
- The month card lists each category’s plan beside forecast, largest absolute difference first, with a running total of those differences and plan / forecast / difference totals above any ignored lines. Ignoring a line treats it as hitting Plan: Forecast moves by that gap, Plan does not change. Pin from that table adds the amount to Plan only. Skipping a category for a month is a plan change, not an ignore.
- A typical-month Budget category is forecast as ongoing even with little history. Pins remain the way to place a one-off on a month.
- A pin on a month can include a comment for why it belongs there. The comment shows on that month and can be edited later.

### Fixed
- A seasonal line that has already started this month (Gas after a fill-up) keeps finishing toward “when it is present.” The first posting is not treated as the whole month.

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
