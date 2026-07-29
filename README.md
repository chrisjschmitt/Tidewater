# Tidewater

A calm, abundance-minded personal budgeting app. It is built to show you that, financially
speaking, you likely already have what you need — and to help you point what is left toward the
life you actually want.

Everything you enter stays in your browser. There is no account, no server, and no analytics.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. To build and serve the production version:

```bash
npm run build
npm run preview
```

Tidewater is an installable PWA, so your browser will offer to install it as an app once built.

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

`Test-Data/Transactions_2026-07-29.csv` is a working example.

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

The chat button answers questions about your own budget. By default it runs entirely on your
device using a rules-based assistant — no network calls, nothing leaves the browser.

You can optionally supply your own OpenAI or Anthropic API key under *Settings* in the chat panel.
If you do, a summary of your budget (totals, categories, goals) is sent to that provider when you
ask a question. Tidewater asks you to confirm that explicitly first, and your key is stored only on
this device. If a request fails, it falls back to the local answer.

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
- **Your data → Export a full backup** gives you JSON including goals and profile.
- **Your data → Start over** erases it.

## Project layout

```
src/lib/          budget maths, CSV parsing, projections, storage, assistant
src/components/   dashboard, group drill-in, goals, chat, onboarding
public/sample/    Ted's default budget
scripts/          sanity checks that run the real parsers against Test-Data
docs/             product spec
```

## Checks

```bash
npm run typecheck       # TypeScript
npm run check:import    # parses Ted's budget and the Monarch export, prints derived totals
npm run check:starter   # generates starter budgets for three household shapes
npm run check:assistant "Where does my money go?"   # shows the local answer for a question
```

## Versions

Release notes live in [`CHANGELOG.md`](CHANGELOG.md). The current version is in `package.json`
(and shown under **Your data**). Bump **MINOR** for user-facing features, **PATCH** for fixes,
and keep `src/lib/version.ts` in sync with `package.json`.

## Built with

React, TypeScript, Vite, Tailwind CSS, PapaParse, idb-keyval, and vite-plugin-pwa — all open
source. Charts are hand-drawn SVG, so there is no charting dependency.
