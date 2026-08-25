/**
 * Local assistant intents against Ted’s sample budget, plus a synthetic
 * ETM/Forecast snapshot. Never reads personal CSVs.
 * Usage: npm run check:assistant
 *        npm run check:assistant "Where does my money go?"
 */
import { readFileSync } from 'node:fs'
import { assistantSystemContext, localAnswer } from '../src/lib/assistant.ts'
import { formatEtmChatSnapshot, type EtmChatSnapshot } from '../src/lib/etmChat.ts'
import { parseBudgetCsv } from '../src/lib/csv.ts'
import type { Budget } from '../src/lib/types.ts'

let failures = 0

function check(label: string, passed: boolean, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!passed) failures++
}

const parsed = parseBudgetCsv(readFileSync('public/sample/ted-budget.csv', 'utf8'))
const budget: Budget = {
  version: 1,
  profile: { name: 'Ted', housing: 'rent', household: 'single', dependents: 0, hasDebt: false, region: 'Calgary' },
  income: parsed.income,
  expenses: parsed.expenses,
  goals: parsed.goals,
  updatedAt: new Date().toISOString(),
  source: 'sample',
}

const questions = process.argv.slice(2)
for (const q of questions) {
  console.log(`\n### ${q}\n`)
  console.log(localAnswer(q, budget))
}

if (questions.length > 0) {
  console.log('\n### flexible lines it can draw on\n')
  for (const l of budget.expenses.filter((e) => !e.essential).sort((a, z) => z.amount - a.amount))
    console.log(` ${String(l.amount).padStart(6)}  ${l.name}`)
}

/** Invented totals — not Ted’s plan, not a personal export. */
const synthetic: EtmChatSnapshot = {
  asOf: '2026-08-15',
  periodLabel: 'August 2026',
  periodMonths: 1,
  windowLabel: '24-month window',
  lookbackFirst: '2024-08',
  lookbackLast: '2026-07',
  lookbackCount: 24,
  typicalMonthPlanCad: 880,
  budgetTab: {
    series: 'budget-tab-actuals',
    income: { CAD: 2500, USD: 0 },
    spend: { CAD: 1234, USD: 0 },
    reimbursableHeldOut: { CAD: 340, USD: 0 },
    plannedTotalCad: 880,
    groups: [
      {
        group: 'Home & Shelter',
        plannedCad: 400,
        actual: { CAD: 400, USD: 0 },
        categories: [{ name: 'Wharf Rent', plannedCad: 400, actual: { CAD: 400, USD: 0 } }],
      },
      {
        group: 'Food & Groceries',
        plannedCad: 400,
        actual: { CAD: 220, USD: 0 },
        categories: [{ name: 'Galley Food', plannedCad: 400, actual: { CAD: 220, USD: 0 } }],
      },
      {
        group: 'Health & Wellbeing',
        plannedCad: 80,
        actual: { CAD: 614, USD: 0 },
        categories: [{ name: 'Clinic', plannedCad: 80, actual: { CAD: 614, USD: 0 } }],
      },
    ],
  },
  reimbursableTab: {
    series: 'reimbursable-tab',
    spend: { CAD: 340, USD: 0 },
    buckets: [
      {
        label: 'Dockside Care',
        spend: { CAD: 140, USD: 0 },
        monthlyActuals: [
          { month: '2026-06', actual: { CAD: 90, USD: 0 } },
          { month: '2026-07', actual: { CAD: 110, USD: 0 } },
          { month: '2026-08', actual: { CAD: 140, USD: 0 } },
        ],
      },
      {
        label: 'Crew Card',
        spend: { CAD: 200, USD: 0 },
        monthlyActuals: [{ month: '2026-07', actual: { CAD: 200, USD: 0 } }],
      },
    ],
    categories: [{ name: 'Physio Float', spend: { CAD: 140, USD: 0 } }],
    monthlyActuals: [
      { month: '2026-06', actual: { CAD: 90, USD: 0 } },
      { month: '2026-07', actual: { CAD: 310, USD: 0 } },
      { month: '2026-08', actual: { CAD: 140, USD: 0 } },
    ],
  },
  forecast: {
    householdCad: {
      series: 'forecast-household',
      currency: 'CAD',
      setAsideLikely: 567,
      setAsideHigh: 700,
      overlayMonthly: 89,
      overlayLines: [{ label: 'Engine Repair', share: 89, lowSample: true }],
      currentMonth: {
        month: '2026-08',
        actualToDate: 1280,
        remain: 200,
        forecastEom: 1480,
        plan: 880,
        overlay: 89,
        remainLines: [{ label: 'Galley Food', remain: 200, reason: 'monthly' }],
      },
    },
    vacationCad: {
      series: 'forecast-vacation',
      currency: 'CAD',
      pot: 4500,
      monthlyContribution: 200,
      currentMonthPaused: false,
      currentMonthActual: 0,
      currentMonthForecast: 0,
    },
    categories: [
      {
        series: 'forecast-household',
        currency: 'CAD',
        label: 'Wharf Rent',
        type: 'predictable-monthly',
        likely: 400,
        typicalMonths: [],
        lowSample: false,
        windowTotal: 9600,
        average12: 400,
        average24: 400,
        monthsPresent: 24,
        monthlyActuals: [
          { month: '2026-06', actual: 400 },
          { month: '2026-07', actual: 400 },
          { month: '2026-08', actual: 400 },
        ],
      },
      {
        series: 'forecast-household',
        currency: 'CAD',
        label: 'Gas',
        type: 'variable-monthly',
        likely: 80,
        typicalMonths: [],
        lowSample: false,
        windowTotal: 1920,
        average12: 80,
        average24: 80,
        monthsPresent: 24,
        monthlyActuals: [
          { month: '2026-06', actual: 72 },
          { month: '2026-07', actual: 88 },
        ],
      },
      {
        series: 'forecast-household',
        currency: 'CAD',
        label: 'Engine Repair',
        type: 'irregular',
        likely: 100,
        typicalMonths: [],
        lowSample: true,
        windowTotal: 400,
        average12: 33,
        monthsPresent: 2,
        monthlyActuals: [{ month: '2026-03', actual: 400 }],
      },
    ],
  },
}

const snapshotText = formatEtmChatSnapshot(synthetic)
const cloudWith = assistantSystemContext(budget, synthetic)
const cloudWithout = assistantSystemContext(budget, null)
const spent = localAnswer('What did I spend this period?', budget, synthetic)
const spentLocked = localAnswer('What did I spend this period?', budget)
const gasHist = localAnswer('historical spending on gas', budget, synthetic)
const gasSpend = localAnswer('How much did I spend on gas?', budget, synthetic)
const reimbQ = localAnswer('What did I spend in the Reimbursable section?', budget, synthetic)
const reimbHist = localAnswer('historical reimbursable spending on dockside care', budget, synthetic)
const forecastQ = localAnswer('What does Forecast say I should set aside?', budget, synthetic)
const forecastLocked = localAnswer('What does Forecast say I should set aside?', budget)
const compareQ = localAnswer('How does my spending compare to the plan?', budget, synthetic)
const planQ = localAnswer('Where does most of my money go?', budget, synthetic)
const howImport = localAnswer('How do I import transactions?', budget)
const howForecast = localAnswer('How do I use the Forecast tab?', budget, synthetic)
const howMonthEnd = localAnswer('How do I use the Month end tab?', budget, synthetic)
const howBudget = localAnswer('How do I use the Budget tab?', budget, synthetic)
const howReimbTab = localAnswer('How do I use the Reimbursable tab?', budget, synthetic)
const howTx = localAnswer('How do I use the Transactions tab?', budget, synthetic)
const howImportTab = localAnswer('How do I use the Import tab?', budget, synthetic)
const howAccounts = localAnswer('How do I use the Accounts tab?', budget, synthetic)
const merchants = ['Pier Housekeeping', 'Cedar Market', 'Cove Pharmacy', 'Nimbus Software', 'Chequing (...1001)']

console.log('\n=== Plan-only (locked / no snapshot) ===')
check(
  'a spend question without a snapshot does not invent actuals',
  /typical-month plan/i.test(spentLocked) && !spentLocked.includes('1,234'),
)
check(
  'a forecast question without a snapshot stays on the plan',
  /typical-month plan/i.test(forecastLocked) && !forecastLocked.includes('$567'),
)
check(
  'cloud context without a snapshot is the existing plan summary',
  cloudWithout.includes("The user's current budget:") &&
    !cloudWithout.includes('Spending and forecast snapshot') &&
    !cloudWithout.includes('Budget-tab actuals'),
)

console.log('\n=== Unlocked synthetic snapshot ===')
check('snapshot names Budget-tab actuals as its own series', snapshotText.includes('Budget-tab actuals'))
check('snapshot names Forecast household', snapshotText.includes('Forecast household'))
check('snapshot names Forecast vacation', snapshotText.includes('Forecast vacation'))
check('snapshot names Reimbursable-tab actuals', snapshotText.includes('Reimbursable-tab actuals'))
check('snapshot lists Reimbursable buckets before August', snapshotText.includes('Dockside Care') && snapshotText.includes('2026-06'))
check('snapshot names overlay as not the Forecast column', /overlay.*not the Forecast column/i.test(snapshotText))
check('snapshot has no merchant or account strings', merchants.every((name) => !snapshotText.includes(name)))
check(
  'a spend question uses Budget-tab actuals, not the typical-month plan alone',
  spent.includes('Budget-tab actuals') && spent.includes('1,234') && spent.includes('Clinic'),
)
check(
  'historical gas uses Forecast lookback months before August',
  /Forecast household/i.test(gasHist) &&
    gasHist.includes('Gas') &&
    gasHist.includes('2026-06') &&
    gasHist.includes('2026-07') &&
    !gasHist.includes('1,234'),
)
check(
  'spend-on-gas uses the same lookback, not only the August Budget-tab series',
  gasSpend.includes('2026-06') && gasSpend.includes('2026-07') && !gasSpend.includes('1,234'),
)
check(
  'a reimbursable question uses Reimbursable-tab actuals, not only the held-out footnote',
  /Reimbursable-tab actuals/i.test(reimbQ) &&
    reimbQ.includes('Dockside Care') &&
    reimbQ.includes('Crew Card') &&
    !reimbQ.includes('1,234'),
)
check(
  'historical reimbursable bucket cites months before August',
  /Reimbursable-tab actuals/i.test(reimbHist) &&
    reimbHist.includes('Dockside Care') &&
    reimbHist.includes('2026-06') &&
    reimbHist.includes('2026-07'),
)
check(
  'snapshot lists Gas posted months before August',
  /\[forecast-household, CAD\] Gas[\s\S]*?2026-06/.test(snapshotText) && snapshotText.includes('2026-07'),
)
check(
  'a forecast question names set-aside, overlay, and vacation as separate series',
  forecastQ.includes('567') &&
    forecastQ.includes('overlay') &&
    forecastQ.includes('vacation') &&
    forecastQ.includes('typical-month plan') &&
    /never paused/i.test(forecastQ),
)
check(
  'plan vs actual keeps Budget-tab actuals distinct from Forecast household',
  compareQ.includes('Budget-tab actuals') &&
    compareQ.includes('Forecast household') &&
    /vacation/i.test(compareQ),
)
check(
  '“where does my money go” still answers from the typical-month plan',
  /flows to/i.test(planQ) && !planQ.includes('1,234'),
)
check(
  'cloud context appends the snapshot and not a transaction list',
  cloudWith.includes('Spending and forecast snapshot') &&
    cloudWith.includes('Budget-tab actuals') &&
    !cloudWith.includes('transaction list') &&
    merchants.every((name) => !cloudWith.includes(name)),
)
check(
  'cloud context still includes the typical-month plan',
  cloudWith.includes('Monthly income:'),
)
check(
  'cloud context includes how to use Tidewater',
  cloudWith.includes('How to use Tidewater') && cloudWithout.includes('How to use Tidewater'),
)
check(
  'a how-to question does not dump the typical-month plan',
  /Import/i.test(howImport) && !howImport.includes('Monthly income:'),
)
check(
  'how to use Forecast is a walkthrough, not the set-aside number',
  /overlay/i.test(howForecast) && /Forecast/i.test(howForecast) && !howForecast.includes('$567') && !howForecast.includes('567'),
)
check(
  'how to use Month end names the checklist steps',
  /Tidy/i.test(howMonthEnd) &&
    /Reimburse/i.test(howMonthEnd) &&
    /Reconcile/i.test(howMonthEnd) &&
    !howMonthEnd.includes('Monthly income:'),
)
check(
  'how to use Budget is plan vs actual, not the dashboard sliders alone',
  /period/i.test(howBudget) && /tie-out/i.test(howBudget) && !howBudget.includes('Monthly income:'),
)
check(
  'how to use Budget mentions chosen spend kept at close',
  /closed/i.test(howBudget) && /chose|chosen/i.test(howBudget),
)
check(
  'how to use Reimbursable names buckets and the hold-out',
  /bucket/i.test(howReimbTab) && /hold/i.test(howReimbTab) && /family/i.test(howReimbTab),
)
check(
  'how to use Transactions mentions filters and cash',
  /filter/i.test(howTx) && /cash/i.test(howTx),
)
check(
  'how to use Import distinguishes the vault from the dashboard Import',
  /vault/i.test(howImportTab) && /typical-month plan/i.test(howImportTab),
)
check(
  'how to use Accounts names funding and the Monarch name',
  /funding/i.test(howAccounts) && /Monarch/i.test(howAccounts),
)

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll assistant checks passed.')
