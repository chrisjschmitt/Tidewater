/**
 * How to use Tidewater, for Ask a question. Compact, no ledger, no merchants.
 * ETM/Forecast how-to is compiled out of the public build.
 */

interface GuideTopic {
  test: RegExp
  etmOnly?: boolean
  reply: string
}

const PLAN_TOPICS: GuideTopic[] = [
  {
    test: /import|monarch|csv|backup|restore|your data|export/i,
    reply: `Use Import in the header for a budget spreadsheet or a Monarch transactions export. Tidewater averages the file into a typical-month plan and skips internal transfers.\n\nYour data holds a JSON backup of the plan, goals, and profile — download it, then restore it from the same place, or drop a .json on Import. Everything stays on this device.\n\nHelp in the header has the same walkthrough if you want it on the page.`,
  },
  {
    test: /goal|rrsp|debt payoff|down payment/i,
    reply: `Goals sit on the dashboard under “What your surplus could become.” Add one, set a monthly amount and a target, and optionally an assumed return — or treat it as debt payoff.\n\nUnallocated money after expenses is what you can point at a goal. Changing a contribution recalculates how long the target takes.\n\nAsk a question can also do the arithmetic (“when will I reach …”) from those same numbers.`,
  },
  {
    test: /slider|group bar|expense group|dashboard|summary ring|unallocated/i,
    reply: `The ring is the typical-month plan: what arrives, what you mean to spend, and what is already pointed at goals. The leftover is unallocated — flexibility, not a leftover to feel guilty about.\n\nGroup bars are largest first. Open a group to change the lines with sliders or by typing. Totals on the ring update as you go.\n\nThis plan is what you meant to spend in a typical month. It is not a transaction list.`,
  },
  {
    test: /cloud|api key|anthropic|openai|assistant settings|on this device/i,
    reply: `Ask a question always works on this device from your typical-month plan. Open Settings in the chat panel if you want your own OpenAI or Anthropic key for fuller answers.\n\nA compact summary may leave the device after you acknowledge that. Keys stay here. The vault and individual transactions never go.\n\nIf a cloud request fails, Tidewater falls back to the on-device answer.`,
  },
  {
    test: /privacy|on(-| )device|indexeddb|leave the device|vault/i,
    reply: `Tidewater has no account and no Tidewater server for your money. The plan lives in this browser. Optional cloud chat sends a compact summary only after you tick the acknowledgement — never the vault, never a transaction list.\n\nYour data is how you copy the plan to another device. There is no analytics.`,
  },
]

const ETM_TOPICS: GuideTopic[] = __ETM_AVAILABLE__
  ? [
      {
        test: /month[- ]?end|workflow|tidy|reconcil|closing balances|monthly savings/i,
        reply: `Month end is the checklist inside unlocked Expenses — the first tab. It walks one calendar month (pick it on the year strip). It explains and records; it never moves money, and nothing here is required.\n\nThe order is the cycle: (1) Tidy — import the latest Monarch file, then clear uncategorized rows, leftover generic reimbursable tags, and untagged claims. (2) Reimbursements — what to ask for, by bucket, a business day before the month ends so repayments land inside it; recording a transfer only notes that you asked. (3) Closing balances — after the month, what each account closed at, from a statement CSV or typed in; statement files are balances only, never transactions. (4) Monthly savings — funding-account balance minus float minus the main card, per currency, with a suggestion to transfer or top up. (5) Reconcile — transaction flow against the change in balances; within tolerance you can close the month. Closing keeps that month’s typical-month spend so the Budget tab can show how the plan has moved against what posted.\n\nThe year strip shows how many of the twelve months are closed. Budget, Reimbursable, and Transactions use the period selector; Month end uses the month you pick here.`,
      },
      {
        test: /budget tab|use (the )?budget|plan and what happened|plan vs actual/i,
        reply: `The Budget tab is plan vs actual for the period in the header selector (a month, year to date, or a custom range). It is observational — not a verdict.\n\nThe top cards are planned (your typical-month plan, multiplied if the period spans more than one month), actually spent, the difference, money in, and money out. Transfers and card payments are left out of those totals. Accounts marked “kept out of the family budget” are left out too. The reimbursable family is held out of Budget-tab actuals; a tie-out names that held-out amount so nothing that left an account is missing.\n\nClosed months keep the typical-month spend as it stood that day. The trend on this tab is that chosen amount beside what posted — so you can see how the plan has moved. Group bars still follow today’s sliders.\n\nOpen a group for categories, then a category for the rows that made it up. Changing the typical-month plan still happens on the dashboard sliders, not here.`,
      },
      {
        test: /forecast tab|use (the )?forecast|set-aside|set aside|overlay|household vs vacation|known future|allow-?list/i,
        reply: `Forecast is its own tab in unlocked Expenses. Pick a lookback (12 months, 24, or all-time). The month card is the Forecast column (calendar) beside actual-to-date, remain, plan, and overlay. Overlay is the irregular smear, not the Forecast column.\n\nThe recommended set-aside sits beside your typical-month plan; chat will not rewrite either. The strip is previous months plus the next year; open a month, pin a known future, or override a category’s type (and typical months when it is seasonal or annual). Vacation is its own card and tags. Allow-listed reimbursable sub-tags can count as household cash; vacation tags never mix in; everything else reimbursable stays out of both. Tagging gaps send you to Month end tidy.\n\nUSD stays beside CAD and is never added in.`,
      },
      {
        test: /reimbursable (tab|section)|use (the )?reimbursable|reimbursable bucket|who owes/i,
        reply: `The Reimbursable tab is the only place that family is counted. Budget-tab actuals hold the whole family out so an advance is not mistaken for household spending.\n\nThe period selector in the header is the grain. Cards show reimbursable out, budget spending, and total out. Buckets are the name after the colon (Healthcare Account, Vacation Account, …), plus any other tags on the row — several names are joined so the buckets still add up to the total. Open a bucket for the rows and, if you want, a display name and who owes it.\n\nForecast treats some of those buckets differently (allow-list vs vacation vs excluded). Ask a question names which series a figure came from.`,
      },
      {
        test: /transactions tab|use (the )?transactions|add cash|cash spending|include transfers/i,
        reply: `The Transactions tab is the whole record for the period in the header selector. Totals (money in, money out, net) follow the active filters.\n\nFilter by search (merchant, statement, or note), account, group, category, tag, whose, and amount. Reimbursable rows stay visible, with a marker — this view never hides them. Tick “Include transfers and card payments” if you want internals in the table; they are off by default.\n\nAdd cash spending when something never hit an export. Manual rows are not overwritten by a later import.`,
      },
      {
        test: /\bimport\b|bring in a monarch|choose a csv|past imports|unmatched account/i,
        reply: `There are two different Imports.\n\nInside Expenses, the Import tab brings a Monarch CSV into the encrypted vault. Choose a CSV; you will see new, updated, and already-here counts. Unrecognised Monarch account names must be set up first (currency matters). Then Bring these in. Transfers are kept but left out of income and spending totals. Past imports can be undone, which puts the vault back as it was, including overwrites. Import as often as you like — rows already here are recognised, and recategorizing in Monarch refreshes here.\n\nThe Import button on the main dashboard is different: it averages a budget spreadsheet or a Monarch file into the typical-month plan, and does not fill the vault.`,
      },
      {
        test: /accounts tab|use (the )?accounts|add an account|funding account|main card|savings destination|kept out of the family budget|monarch name/i,
        reply: `The Accounts tab is what each account means. Add one, or let Expenses Import offer to create names it finds. The nickname is yours; the Monarch name must match the export exactly so rows land here. Last four is display only. Currency is tracked as-is, never converted. Full account numbers are never asked for.\n\nFlags: funding (everything is paid from here, with an optional float left behind), main card (cleared each month), savings destination (where surplus goes), and kept out of the family budget (spending skipped on Budget-tab actuals, but reimbursable claims on that account still count). Funding, main card, and float feed Month end’s monthly savings figure.`,
      },
      {
        test: /unlock|enablement|expenses key|passphrase|lock expenses/i,
        reply: `Expenses is optional and encrypted. Open Expenses in the header, choose an enablement key, and remember it — it is real protection, not a switch. Tidewater cannot read the vault without it.\n\nA remembered unlock still needs one click on Expenses in a later session. Lock from the expenses header when you are done.\n\nUntil it is unlocked, Ask a question only sees the typical-month plan.`,
      },
    ]
  : []

const TOPICS: GuideTopic[] = [...ETM_TOPICS, ...PLAN_TOPICS]

/** Narrow: how to use the app, not “how much did I spend”. */
const HOW_TO =
  /how do i|how to (use|import|unlock|add|set|open|enable|backup|restore|change)|where (is|do i find|can i find)|help me (use|with) (the |this )?app|using (the |this )?app|how does (this |the )?app work|what (does|do) (the )?(forecast|expenses?|reimbursable|budget|month[- ]?end|transactions?|accounts?|import) tab|(month[- ]?end|forecast|reimbursable|budget|transactions|accounts|import) tab/i

export function replyAppGuide(question: string): string | null {
  if (!HOW_TO.test(question)) return null
  const topic = TOPICS.find((item) => item.test.test(question))
  return topic?.reply ?? fallbackGuide()
}

function fallbackGuide(): string {
  const etm = __ETM_AVAILABLE__
    ? ' While Expenses is unlocked I can walk through every tab there: Month end, Budget, Forecast, Reimbursable, Transactions, Import, and Accounts.'
    : ''
  return `I can help with using Tidewater as well as with the numbers.\n\nThe dashboard is the typical-month plan — ring, group bars, goals. Import brings a spreadsheet or Monarch file. Your data is the backup. Help in the header is the on-page guide.${etm}\n\nTry “how do I import,” “how do I add a goal,” or “how do I use the Forecast tab.” For figures, ask where the money goes or what posted.`
}

/** Compact how-to for the optional cloud prompt. */
export function appGuideContext(): string {
  const core = `How to use Tidewater (product, not the user's ledger):
- Dashboard: typical-month plan. Ring = income, planned spend, goals. Bars = groups, largest first; open a group to edit lines. Unallocated is leftover flexibility.
- Import (header): budget CSV or Monarch transactions CSV (averages into the plan; skips internal transfers). Your data: JSON backup/restore of the plan. On this device only.
- Goals: dashboard panel; monthly contribution, target, optional return, or debt payoff.
- Ask a question: on-device from the plan; optional user-owned OpenAI/Anthropic key in chat Settings. Compact summary may leave after acknowledgement. Vault and transactions never leave.
- Help in the header is the same guide on the page. Chat does not rewrite the Budget or Forecast.`

  if (!__ETM_AVAILABLE__) return core

  return `${core}
- Expenses (optional, encrypted enablement key). Tabs:
  - Month end: checklist for one month on the year strip. Tidy tags, Reimbursements to ask for before month-end, Closing balances from statements after it, Monthly savings suggestion, Reconcile and optionally close. Closing keeps that month’s typical-month spend. Never moves money.
  - Budget: plan vs actual for the header period selector. Closed months show chosen spend at close beside actuals. Groups then categories then rows. Reimbursable family held out (tie-out names it). Transfers and “kept out of the family budget” accounts omitted. Plan edits stay on the dashboard.
  - Forecast: 12 / 24 / all-time lookback. Set-aside beside the typical-month plan. Overlay is the irregular smear, not the Forecast column. Pin known futures; override category type. Household allow-list vs vacation series vs excluded reimbursable. CAD and USD never added.
  - Reimbursable: whole family by bucket for the period selector — the only place that family is counted.
  - Transactions: whole record for the period; filters; reimbursable rows marked not hidden; add cash spending; internals off until included.
  - Import (this tab): Monarch CSV into the vault. Match unmatched accounts, then Bring these in. Undo a past import. Distinct from header Import, which averages into the typical-month plan.
  - Accounts: nickname, Monarch name, currency as-is, funding / main card / savings / excluded-from-budget flags. Float on the funding account feeds Month end savings.
- Until Expenses is unlocked, chat only has the typical-month plan. Chat never sees merchants, accounts, or the vault.`
}
