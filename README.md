# Tidewater

A calm, abundance-minded personal budgeting app. It is built to show you that, financially
speaking, you likely already have what you need — and to help you point what is left toward the
life you actually want.

Everything you enter stays in your browser. There is no account, no server, and no analytics.

Live site: [https://tidewater-one.vercel.app](https://tidewater-one.vercel.app)

## Installation

Tidewater is a Progressive Web App (PWA). Personal data stays in the browser (or browser profile)
used to open it — nothing is uploaded to a Tidewater server.

### Option A — MacBook: Tidewater.app (recommended)

A double-clickable Mac app is built into this repo.

1. In Terminal, from the project folder:

   ```bash
   npm run app:mac
   ```

   This writes `dist-native/Tidewater.app`.

2. In Finder, open the `dist-native` folder.
3. Drag **Tidewater.app** into **Applications** (or keep it in `dist-native` / on the Desktop).
4. Double-click **Tidewater** to launch.
5. If macOS says the app can’t be opened because it is from an unidentified developer:
   - Control-click (or right-click) **Tidewater.app** → **Open** → **Open**.
   - You only need to do this once.

What it does: opens the live Tidewater site in an app-style window using Google Chrome, Microsoft
Edge, or Brave if installed; otherwise it opens Safari.

Optional — point the app at a local dev server instead of production:

```bash
npm run dev
# in another terminal:
TIDEWATER_URL=http://localhost:5173 npm run app:mac
```

Then launch the rebuilt `dist-native/Tidewater.app`.

### Option B — MacBook: install from the browser

1. Open [https://tidewater-one.vercel.app](https://tidewater-one.vercel.app) in Chrome, Edge, or Safari.
2. **Chrome / Edge:** click the install icon in the address bar (or the browser menu → **Install Tidewater** / **Open as app**).
3. **Safari (macOS):** **File → Add to Dock**.

Tidewater then appears as its own window with the Tidewater icon.

### Option C — iPad: Add to Home Screen

iPadOS does not run the Mac `.app`. Install the PWA from Safari:

1. Open **Safari** on the iPad (not Chrome — home-screen install is a Safari feature).
2. Go to [https://tidewater-one.vercel.app](https://tidewater-one.vercel.app).
3. Tap the **Share** button (square with an arrow).
4. Scroll and tap **Add to Home Screen**.
5. Keep the name **Tidewater**, confirm the icon, then tap **Add**.

Launch Tidewater from the home screen like any other app. It opens full screen; your budget stays
on that iPad.

> **Note:** The home-screen icon is served from the live site. After icon updates are merged and
> deployed to Vercel, remove the old home-screen icon and add it again if the icon does not refresh.

### Updating the Mac app icon assets

Icons live under `public/icons/` (plus `public/apple-touch-icon.png` and `native/mac/AppIcon.icns`).
Rebuild from the 1024×1024 master:

```bash
npm run icons
npm run app:mac
```

## Running from source (developers)

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Production build:

```bash
npm run build
npm run preview
```

To ship a build without the optional expense tracking module (no entry
point, and none of its code in the bundle):

```bash
npm run build:public
```

`npm run dev:public` runs the dev server the same way.

## Expenses and Forecast

Unlocking the optional expense tracking module (same device key as always) adds an Expenses area. Inside it, the **Forecast** tab is a reading of those transactions and the current budget: household timeline (actual beside forecast; household at the bottom of each bar, reimbursable buckets stacked above), the month card, last month’s snapshot, categories, and a vacation series of its own. Lookback window, which tags count as household or vacation, a local folder to watch for newer Monarch CSVs, and erasing the vault live on the **Settings** tab. A watched folder only offers a file for the existing Import review — nothing is written until you confirm. Nothing in Forecast rewrites the budget unless you choose to apply a contribution. Personal data stays in the encrypted store on this device. The public build (`npm run build:public`) does not include this tab.

## Three ways to start

| Path | What happens |
|------|--------------|
| **Start fresh** | Five short questions (income, housing, household, debt) produce a realistic starting budget you can adjust. |
| **Import a file** | Load a Tidewater budget CSV, a full JSON backup, or a transaction export from Monarch Money. |
| **Look around first** | Loads Ted's sample budget — a 30-year-old renter in Calgary with a mid-level management job. |

## Importing transactions

Point it at a Monarch Money CSV export (`Date, Merchant, Category, Account, Amount, …`) and
Tidewater derives an average monthly income and spend:

- Transfers between your own accounts and credit card payments are excluded, since they move money
  rather than spend it.
- Refunds and reimbursements are netted against the category they came from, so a category's sign
  decides whether it counts as income or spending.
- The averaging window is the elapsed time between your first and last transaction, not the number
  of calendar months touched.
- Categories are merged case-insensitively, so `Groceries` and `GROCERIES` become one line.
- Categories are mapped onto ten groups by keyword. Anything unrecognised lands in *Everything Else*
  and can be moved by hand. The full keyword lists and ordering rules are in
  [docs/category-mapping.md](docs/category-mapping.md).

### Sample files and the Monarch fixture

| File | What it is |
|------|------------|
| `public/sample/ted-budget.csv` | Balanced starter budget (also used by **Look around first**) |
| `public/sample/noel-budget.csv` | Overspending budget with no savings goals |
| `public/sample/monarch-fixture.csv` | Fake ~12 months of Monarch-style transactions for testing import |

**When to use the Monarch fixture**

- After changing CSV parsing, category mapping (`src/lib/categories.ts`), or the import review UI
- Before a release or PR that touches `src/lib/csv.ts` / `scripts/check-import.ts`
- Anytime you want a repeatable import without using personal bank data

**How to run it in the app**

1. Start the app (`npm run dev`) and open http://localhost:5173 — or use the live site.
2. Click **Import** (or **Import a file** on the welcome screen).
3. Choose `public/sample/monarch-fixture.csv`.
4. Confirm the import review: you should see averaged monthly income/spend, internal transfers
   skipped, and categories sorted into Tidewater groups.

**How to run it from the command line**

```bash
npm run check:import
```

That always parses Ted’s budget, Noel’s budget, and `monarch-fixture.csv`, then prints derived
totals and spending-by-group. No browser required. Use this as a quick regression check while
coding.

**Personal exports (optional)**

`Test-Data/` is gitignored. If you drop a real Monarch CSV there (for example
`Test-Data/Transactions_2026-07-29.csv`), `npm run check:import` will also summarize it after the
sanitized fixture. Prefer the fixture for anything that gets committed or shared.

## The budget CSV format

Small enough to edit in any spreadsheet. `public/sample/ted-budget.csv` is the reference.

```csv
Type,Name,Group,Monthly Amount,Target,Current,Annual Rate %
Income,Salary (after tax),,5850.00,,,
Expense,Rent — 1 bedroom apartment,home,1650.00,,,
Goal,RRSP,,400.00,120000.00,14500.00,5.0
Debt,Credit card,,250.00,,4000.00,19.99
```

`Group` is optional — leave it blank and the category name is matched to a group automatically.
Valid groups: `home`, `food`, `transport`, `health`, `personal`, `joy`, `family`, `financial`,
`future`, `other`.

## The assistant

The chat button answers questions about your typical-month plan and how to use Tidewater. By default it runs entirely on your
device using a rules-based assistant — no network calls, nothing leaves the browser. While expense
tracking is unlocked, it can also see a compact snapshot of actuals and Forecast patterns (totals
and classifications). It never sees the ledger, merchants, or the vault.

You can optionally supply your own OpenAI or Anthropic API key under *Settings* in the chat panel.
If you do, a summary of your plan (totals, categories, goals) is sent to that provider when you
ask a question. If expense tracking is unlocked, the same compact spending/forecast snapshot is
included — still not transactions. Tidewater asks you to confirm that explicitly first, and your
key is stored only on this device. If a request fails, it falls back to the local answer.

Each provider keeps its own key and model, so switching between them never sends the wrong key.

For Anthropic, Tidewater recommends just two models:

- **Claude Haiku 4.5 — `$`, lowest cost:** the default for routine budget questions.
- **Claude Sonnet 5 — `$$`, more expensive:** stronger reasoning for detailed trade-offs and plans.

Expensive agentic models such as Opus and Fable are unnecessary for normal Tidewater questions and
stay under **Other models**. Opening that section asks the provider which models your key can
actually use (`GET /v1/models`). The cost symbols are relative guidance, not a price quote; provider
pricing can change.

### Known limitation: the local assistant matches keywords

The on-device assistant is not a language model. `src/lib/assistant.ts` holds an ordered list of
intents, each a regular expression paired with a function that computes an answer from your budget.
**The first regex that matches wins**, and everything else in the question is discarded.

That is fine for direct questions and wrong for compound ones. Two examples that misfire today:

| Question | What happens |
|----------|--------------|
| "Where can I reduce my costs to save for a $2,000 vacation this summer" | Matches on `reduce`, so it suggests general trimming and ignores both the $2,000 and the deadline. |
| "Can I afford a $2,000 vacation this summer" | Matches on `vacation` in the *goals* intent, so it reports on your RRSP and down payment instead of answering. |

The affordability intent already does the right arithmetic — amount divided by monthly surplus — but
it sits later in the list, so an earlier keyword usually claims the question first. A question can
carry an amount, a deadline, and an intent at once; first-match-wins can only act on one of them.

Fixing this properly means scoring all intents and combining the amount, the deadline, and the
intent into one answer. Until then, compound questions like these are better asked with an API key
configured. `npm run check:assistant "your question"` shows which intent a question matches.

## Your data

- Stored in IndexedDB in this browser only.
- **Your data → Export as a budget file** gives you a CSV for another device or a spreadsheet.
- **Your data → Export a full backup** gives you JSON including goals and profile. If expense tracking is set up, the encrypted vault rides along (the key is not in the file). Without expense tracking, the file is still just the plan.
- **Your data → Start over** erases it.

## Project layout

```
src/lib/          budget maths, CSV parsing, projections, storage, assistant
src/components/   dashboard, group drill-in, goals, chat, onboarding
public/icons/     PWA and home-screen PNG icons
public/sample/    Ted & Noel budgets; monarch-fixture.csv for import tests
native/mac/       macOS AppIcon.icns source
dist-native/      Tidewater.app (from npm run app:mac)
scripts/          sanity checks, icon build, Mac app build
docs/             product spec and category mapping
```

## Checks

```bash
npm run typecheck       # TypeScript
npm run check:import    # Ted + Noel budgets and monarch-fixture.csv (plus local Test-Data if present)
npm run check:starter   # generates starter budgets for three household shapes
npm run check:assistant                         # local intents, including plan vs a synthetic ETM snapshot
npm run check:assistant "Where does my money go?"   # also prints the local answer for a question
npm run check:forecast  # synthetic forecast fixture (classifications, coverage, snapshots)
```

Run `check:import` whenever you change import or category-mapping code; details are under
**Sample files and the Monarch fixture** above.
## Versions

Release notes live in [`CHANGELOG.md`](CHANGELOG.md). The current version is in `package.json`
(and shown under **Your data**). Bump **MINOR** for user-facing features, **PATCH** for fixes,
and keep `src/lib/version.ts` in sync with `package.json`.

## Built with

React, TypeScript, Vite, Tailwind CSS, PapaParse, idb-keyval, and vite-plugin-pwa — all open
source. Charts are hand-drawn SVG, so there is no charting dependency.
