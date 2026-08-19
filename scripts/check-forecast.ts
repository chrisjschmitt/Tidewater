/**
 * Sanity check for the forecasting engine against a synthetic Monarch fixture.
 * Usage: npm run check:forecast
 *
 * Personal exports are never read. Hand calculations below are for the invented
 * merchants in public/sample/forecast-fixture.csv only.
 */
import { readFileSync } from 'node:fs'
import { groupForCategory, isInternalCategory } from '../src/lib/categories.ts'
import { walkForward } from '../src/lib/forecast/backtest.ts'
import { cvOf } from '../src/lib/forecast/classify.ts'
import {
  forecast,
  isOutsideControlWindow,
  lookbackMonths,
} from '../src/lib/forecast/forecast.ts'
import { deriveKey, open, randomSalt, seal } from '../src/lib/etm/crypto.ts'
import { withForecastDefaults, type ForecastConfig } from '../src/lib/forecast/types.ts'
import {
  appearedSubtags,
  assignSeries,
  completeSubtag,
  householdTagOptions,
  isParentOnlyReimbursable,
  isUncategorizedCategory,
  nameKey,
  splitUniverse,
  tagSelected,
  taggingGaps,
  withAllowListedTag,
  withVacationTag,
} from '../src/lib/forecast/universe.ts'
import { parseMonarchCsv, type MonarchRow } from '../src/lib/etm/monarch.ts'
import type { Currency, Transaction } from '../src/lib/etm/types.ts'
import type { Budget } from '../src/lib/types.ts'

let failures = 0

function check(label: string, passed: boolean, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!passed) failures++
}

const round = (n: number) => Math.round(n * 100) / 100
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

const ASOF = '2026-08-15'
const N24 = 24
const IRREGULAR_TOTAL = 2400 + 84 + 300 + 90
const OVERLAY = IRREGULAR_TOTAL / N24
const PLACE = 2400
const TYPICAL = 400 + 400 + 80

const budget: Budget = {
  version: 1,
  profile: {
    name: 'Fixture',
    housing: 'rent',
    household: 'partnered',
    dependents: 0,
    hasDebt: false,
    region: 'Calgary',
  },
  income: [{ id: 'pay', name: 'Paycheque', amount: 2500 }],
  expenses: [
    { id: 'dues', name: 'Harbor Dues', groupId: 'home', amount: 400, essential: true },
    { id: 'food', name: 'Market Basket', groupId: 'food', amount: 400, essential: true },
    { id: 'pharm', name: 'Pharmacy', groupId: 'health', amount: 80, essential: true },
  ],
  goals: [
    {
      id: 'emergency',
      name: 'Emergency fund',
      kind: 'savings',
      target: 10000,
      current: 2000,
      monthly: 400,
      annualRate: 3,
    },
    {
      id: 'vac',
      name: 'Vacation',
      kind: 'savings',
      target: 8000,
      current: 4500,
      monthly: 2000,
      annualRate: 3,
    },
  ],
  updatedAt: `${ASOF}T00:00:00.000Z`,
  source: 'sample',
}

function toTransactions(rows: MonarchRow[]): Transaction[] {
  return rows.map((row, i) => {
    const usd = /us /i.test(row.account)
    return {
      id: `fx-${i}`,
      date: row.date,
      merchant: row.merchant,
      originalStatement: row.originalStatement,
      notes: row.notes,
      amount: row.amount,
      currency: (usd ? 'USD' : 'CAD') as Currency,
      accountId: usd ? 'usd' : 'cad',
      monarchAccount: row.account,
      category: row.category,
      groupId: groupForCategory(row.category),
      internal: isInternalCategory(row.category),
      tags: row.tags,
      owner: row.owner,
      reviewed: row.reviewed,
      source: 'monarch' as const,
      importBatchId: 'fixture',
    }
  })
}

const cat = (result: ReturnType<typeof forecast>, name: string) =>
  result.cad.household.categories.find((c) => c.key === nameKey(name))

const monthPoint = (result: ReturnType<typeof forecast>, month: string) =>
  result.cad.household.calendar.find((p) => p.month === month)

const fixture = readFileSync('public/sample/forecast-fixture.csv', 'utf8')
const { rows } = parseMonarchCsv(fixture)
const transactions = toTransactions(rows)
const base = withForecastDefaults({ window: 24 })

console.log('=== Fixture ===')
check('the synthetic fixture parses', rows.length === 122, `${rows.length} rows`)
check('lookback is 24 full months ending July 2026', lookbackMonths(ASOF, 24, '2024-08').join(',') === lookbackMonths(ASOF, 24, rows[0]!.date).join(',') && lookbackMonths(ASOF, 24, '2024-08').length === 24)

console.log('\n=== Three-way split ===')
const split = splitUniverse(transactions, base)
check('allow-listed healthcare is household', split.household.some((t) => t.category === 'Pharmacy'))
check('allow-listed capital is household', split.household.some((t) => t.category === 'Yard Tools'))
check('allow-listed annual fees are household', split.household.some((t) => t.category === 'Registry Fees'))
check('business reimbursable is excluded', split.excluded.some((t) => t.category === 'Studio Work'))
check('parent-only reimbursable is excluded', split.excluded.some((t) => t.category === 'Pocket Advance'))
check('vacation lodging is vacation only', split.vacation.some((t) => t.category === 'Trip Lodging') && !split.household.some((t) => t.category === 'Trip Lodging'))
check(
  'vacation wins over an allow-listed healthcare tag',
  split.vacation.some((t) => t.category === 'Trail Clinic') && !split.household.some((t) => t.category === 'Trail Clinic'),
)
check('internal transfers are dropped', split.dropped.some((t) => t.category === 'Transfer'))
check('card payments are dropped', split.dropped.some((t) => t.category === 'Credit Card Payment'))
check('paycheques are dropped', split.dropped.some((t) => t.category === 'Paycheque'))
check(
  'family match ignores extra spaces after the colon',
  assignSeries(
    { ...transactions[0]!, tags: ['Reimbursable:  Healthcare Account'], category: 'Pharmacy', internal: false },
    base,
    'Reimbursable',
  ) === 'household',
)

const result = forecast(transactions, budget, base, ASOF)

check('household count includes CAD and USD spend rows', result.seriesCounts.household === split.household.length)
check('vacation count is the three trip rows', result.seriesCounts.vacation === 3)
check('excluded count is business + parent-only', result.seriesCounts.excluded === 2)
check('dropped count is transfer + card + paycheque', result.seriesCounts.dropped === 3)

console.log('\n=== Currency (never mixed) ===')
const cadLookback = result.cad.household.categories.reduce((sum, c) => sum + c.windowTotal, 0)
const usdLookback = result.usd.household.categories.reduce((sum, c) => sum + c.windowTotal, 0)
check('CAD household lookback is 25754', near(cadLookback, 25754), `got ${cadLookback}`)
check('USD cloud software is 360 and stays in USD', near(usdLookback, 360), `got ${usdLookback}`)
check('USD is not folded into CAD', !result.cad.household.categories.some((c) => c.key === nameKey('Cloud Software')))

console.log('\n=== Classification (24-month window) ===')
const dues = cat(result, 'Harbor Dues')
const basket = cat(result, 'Market Basket')
const dock = cat(result, 'Dock Club')
const gifts = cat(result, 'Shore Gifts')
const repair = cat(result, 'Engine Repair')
const lantern = cat(result, 'Lantern App')
const insurance = cat(result, 'Harbor Insurance')

check('Harbor Dues is predictable monthly', dues?.type === 'predictable-monthly')
check('Harbor Dues likely is 400', dues?.likely === 400)
check('Harbor Dues 12- and 24-month averages are 400', dues?.average12 === 400 && dues?.average24 === 400)
check('Market Basket is variable monthly', basket?.type === 'variable-monthly')
check(
  'Market Basket cv is above 0.20',
  (basket?.cv ?? 0) > 0.2,
  `cv ${basket?.cv}`,
)
check('Dock Club is predictable annual', dock?.type === 'predictable-annual')
check('Dock Club typical month is March', dock?.typicalMonths.join() === '3')
check('Harbor Insurance is predictable annual in August', insurance?.type === 'predictable-annual' && insurance.typicalMonths.join() === '8')
check('Shore Gifts is seasonal in June and December', gifts?.type === 'seasonal' && gifts.typicalMonths.join() === '6,12')
check('Engine Repair is irregular + low (one spike)', repair?.type === 'irregular' && repair.lowSample && repair.confidence === 'low')
check('Lantern App is irregular + low (emerging, not annual)', lantern?.type === 'irregular' && lantern.lowSample)

const twelve = forecast(transactions, budget, withForecastDefaults({ window: 12 }), ASOF)
check(
  'a single Dock Club hit in 12 months is irregular, not annual',
  cat(twelve, 'Dock Club')?.type === 'irregular' && cat(twelve, 'Dock Club')?.lowSample === true,
)

console.log('\n=== Calendar placement ===')
const march = monthPoint(result, '2027-03')
const april = monthPoint(result, '2027-04')
const december = monthPoint(result, '2026-12')
const june = monthPoint(result, '2027-06')
check('March forecast includes the Dock Club annual', (march?.byCategory.find((c) => c.key === nameKey('Dock Club'))?.forecast ?? 0) === 180)
check('April does not place Dock Club', !april?.byCategory.some((c) => c.key === nameKey('Dock Club') && c.forecast > 0))
check('December places Shore Gifts', (december?.byCategory.find((c) => c.key === nameKey('Shore Gifts'))?.forecast ?? 0) === 50)
check('June places Shore Gifts', (june?.byCategory.find((c) => c.key === nameKey('Shore Gifts'))?.forecast ?? 0) === 50)
check('irregular Engine Repair is not projected onto a future month', !result.cad.household.calendar.some((p) => p.kind === 'future' && p.byCategory.some((c) => c.key === nameKey('Engine Repair') && c.forecast > 0 && c.source !== 'known-future')))
check('the household strip is 24 months', result.cad.household.calendar.length === 24)
check(
  'last August on the strip carries Harbor Insurance, not vacation lodging',
  (monthPoint(result, '2025-08')?.byCategory.find((c) => c.key === nameKey('Harbor Insurance'))?.actual ?? 0) === 600 &&
    !monthPoint(result, '2025-08')?.byCategory.some((c) => c.key === nameKey('Trip Lodging')),
)
check('vacation actuals are absent from the household strip', result.cad.household.calendar.every((p) => !p.byCategory.some((c) => c.key === nameKey('Trip Lodging'))))

console.log('\n=== Overlay identity ===')
check('irregular window total is 2874', result.cad.household.overlay.irregularWindowTotal === IRREGULAR_TOTAL, `got ${result.cad.household.overlay.irregularWindowTotal}`)
check('unplaced overlay is total / N', near(result.cad.household.overlay.monthly, OVERLAY), `got ${result.cad.household.overlay.monthly}`)

const placed: ForecastConfig = withForecastDefaults({
  window: 24,
  knownFutures: [
    {
      id: 'repair-dec',
      category: 'Engine Repair',
      amount: PLACE,
      month: '2026-12',
      recurrence: 'once',
      series: 'household',
      notes: 'booked',
    },
  ],
})
const after = forecast(transactions, budget, placed, ASOF)
check(
  'placing 2400 shrinks the overlay by amount / N',
  near(after.cad.household.overlay.monthly, (IRREGULAR_TOTAL - PLACE) / N24),
  `got ${after.cad.household.overlay.monthly}, expected ${round((IRREGULAR_TOTAL - PLACE) / N24)}`,
)
check(
  'the drop equals 2400 / 24',
  near(result.cad.household.overlay.monthly - after.cad.household.overlay.monthly, PLACE / N24),
)

console.log('\n=== Control window ===')
const decBefore = monthPoint(result, '2026-12')
const decAfter = monthPoint(after, '2026-12')
const gapBefore = Math.abs((decBefore?.calendar ?? 0) - (decBefore?.plan ?? 0)) / (decBefore?.plan || 1)
const gapAfter = Math.abs((decAfter?.calendar ?? 0) - (decAfter?.plan ?? 0)) / (decAfter?.plan || 1)
check('December starts outside ±5% (seasonal gifts vs typical month)', decBefore?.outsideControlWindow === true, `gap ${(gapBefore * 100).toFixed(2)}%`)
check('placing the December repair brings December inside ±5%', decAfter?.outsideControlWindow === false, `gap ${(gapAfter * 100).toFixed(2)}%`)
check(
  'the control-window helper agrees',
  isOutsideControlWindow(decBefore?.calendar ?? 0, decBefore?.plan ?? 0) &&
    !isOutsideControlWindow(decAfter?.calendar ?? 0, decAfter?.plan ?? 0),
)
check('December plan includes the known future', decAfter?.plan === TYPICAL + PLACE)

console.log('\n=== Current-month remainder ===')
const current = result.cad.household.currentMonth
check('August actual to date is 1280 (dues + basket + pharmacy + posted insurance)', current.actualToDate === 1280, `got ${current.actualToDate}`)
check('posted Harbor Insurance is not left as a remainder', current.postedTypicalKeys.includes(nameKey('Harbor Insurance')))
check('forecast to month-end does not double-count the posted annual', current.forecastEom === 1480, `got ${current.forecastEom}`)
check('Market Basket remainder is 200', current.remain === 200, `got ${current.remain}`)

console.log('\n=== Coverage (9 of 10, vacation ignored) ===')
check('vacation goal is matched by name', result.vacationGoal.status === 'matched')
check('household committed excludes the 2000 vacation contribution', result.coverage.householdCommitted === 400, `got ${result.coverage.householdCommitted}`)
check('coverage uses a 90% bar', result.coverage.coverageTarget === 0.9)
check('household goals are funded at 9-of-10 on this fixture', result.coverage.funded && result.coverage.coverage >= 0.9, `coverage ${(result.coverage.coverage * 100).toFixed(1)}%`)

console.log('\n=== Vacation series ===')
const july = result.cad.vacation.months.find((m) => m.month === '2026-07')
check('July 2026 is a travel month', july?.isTravel === true)
check('vacation contribution is paused in a trip month', july?.contribution === 0)
const sep = result.cad.vacation.months.find((m) => m.month === '2026-09')
check('a non-travel month still contributes', (sep?.contribution ?? 0) === 2000)

console.log('\n=== Walk-forward per-type errors ===')
const walked = walkForward(transactions, budget, base, ASOF)
const monthlyMae = walked.byType['predictable-monthly'].mae
check('predictable-monthly walk-forward MAE is tight on this fixture', monthlyMae < 5, `mae ${monthlyMae.toFixed(2)}`)
check('walk-forward ran over the previous 12 months', walked.months.length === 12, `${walked.months.length} months`)

console.log('\n=== Classifier stats (hand check) ===')
const basketAmounts = [200, 400, 600, 200, 400, 600, 200, 400, 600, 200, 400, 600, 200, 400, 600, 200, 400, 600, 200, 400, 600, 200, 400, 600]
check('Market Basket cv matches the repeating 200/400/600 series', near(cvOf(basketAmounts), basket?.cv ?? -1, 0.002))

console.log('\n=== Defaults ===')
check(
  'an omitted allow-list still receives the household defaults',
  withForecastDefaults({}).reimbursableAllowList.length === 3,
)
check(
  'an explicitly empty allow-list is kept',
  withForecastDefaults({ reimbursableAllowList: [] }).reimbursableAllowList.length === 0,
)
check(
  'an omitted vacation list still defaults',
  withForecastDefaults({}).vacationTags.join() === 'Reimbursable: Vacation Account',
)

console.log('\n=== Tagging gaps (untagged / parent-only) ===')
const fixtureGaps = taggingGaps(transactions, base)
check('fixture has one parent-only reimbursable', fixtureGaps.parentOnlyReimbursable === 1, `${fixtureGaps.parentOnlyReimbursable}`)
check('fixture has no uncategorized household rows', fixtureGaps.uncategorizedHousehold === 0)
check(
  'Pocket Advance is parent-only',
  isParentOnlyReimbursable(['Reimbursable']) && !isParentOnlyReimbursable(['Reimbursable', 'Reimbursable: Healthcare Account']),
)
check('blank and Uncategorized are both uncategorized', isUncategorizedCategory('') && isUncategorizedCategory('Uncategorized'))
const gapTx = (partial: Pick<Transaction, 'category' | 'tags'> & Partial<Transaction>): Transaction => ({
  id: partial.id ?? 'gap',
  date: partial.date ?? '2026-03-04',
  merchant: 'Fixture Counter',
  originalStatement: '',
  notes: '',
  amount: -12,
  currency: 'CAD',
  accountId: 'cad',
  monarchAccount: 'Chequing',
  category: partial.category,
  groupId: 'other',
  internal: partial.internal ?? false,
  tags: partial.tags,
  owner: '',
  reviewed: true,
  source: 'monarch',
  importBatchId: 'gaps',
})
const withGaps = taggingGaps(
  [
    gapTx({ category: 'Uncategorized', tags: [] }),
    gapTx({ id: 'v', category: 'Uncategorized', tags: ['Reimbursable: Vacation Account'] }),
    gapTx({ id: 'p', category: 'Pocket Advance', tags: ['Reimbursable'] }),
    gapTx({ id: 't', category: 'Transfer', tags: [], internal: true }),
  ],
  base,
)
check('uncategorized household is counted once', withGaps.uncategorizedHousehold === 1)
check('vacation uncategorized is not household', withGaps.uncategorizedHousehold === 1)
check('parent-only is counted, internals are not', withGaps.parentOnlyReimbursable === 1)

console.log('\n=== Tag lists ===')
const appeared = appearedSubtags(transactions)
check(
  'fixture sub-tags include the allow-list, vacation, and business',
  ['Healthcare', 'Capital', 'Annual Fees', 'Vacation', 'Business'].every((name) =>
    appeared.some((tag) => tag.includes(name)),
  ),
  appeared.join('; '),
)
const householdOpts = householdTagOptions(appeared, base.reimbursableAllowList, base.vacationTags)
check(
  'vacation is not offered as a household tag',
  !householdOpts.some((tag) => /vacation/i.test(tag)),
)
const moved = withVacationTag(base, 'Reimbursable: Healthcare Account', true)
check(
  'marking a tag as vacation takes it off the household allow-list',
  !tagSelected(moved.reimbursableAllowList, 'Reimbursable: Healthcare Account') &&
    tagSelected(moved.vacationTags, 'Reimbursable: Healthcare Account'),
)
check('a typed name is prefixed with the parent', completeSubtag('Rainy Day') === 'Reimbursable: Rainy Day')
check('the parent tag alone is not a sub-tag', completeSubtag('Reimbursable') === '')
const added = withAllowListedTag(base, 'Rainy Day', true)
check('adding a household tag does not require the parent prefix', tagSelected(added.reimbursableAllowList, 'Reimbursable: Rainy Day'))

console.log('\n=== Sealed forecast config ===')
const salt = randomSalt()
const key = await deriveKey('correct horse battery staple', salt)
const wrongKey = await deriveKey('correct horse battery stapl', salt)
const stored = withForecastDefaults({ window: 24 })
const sealed = await seal(key, stored)
const opened = await open<ForecastConfig>(key, sealed)
check('the right key opens the forecast config', opened.window === 24)
check(
  'the ciphertext does not contain allow-list names',
  !Buffer.from(sealed.data).includes(Buffer.from('Healthcare')),
)
let wrongKeyRejected = false
try {
  await open(wrongKey, sealed)
} catch {
  wrongKeyRejected = true
}
check('a wrong key cannot read the forecast config', wrongKeyRejected)

console.log('\n=== Main bundle stays clear of forecasting ===')
const appSource = readFileSync('src/App.tsx', 'utf8')
check(
  'App.tsx does not import the forecast engine or panel',
  !appSource.includes('lib/forecast') && !appSource.includes('ForecastPanel'),
)

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll forecast checks passed.')
