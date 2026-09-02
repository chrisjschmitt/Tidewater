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
  forecastMix,
  isOutsideControlWindow,
  lookbackMonths,
  usesPlanPrior,
  vacationSweep,
  withCompareIgnores,
} from '../src/lib/forecast/forecast.ts'
import { classifyCategory } from '../src/lib/forecast/classify.ts'
import { deriveKey, open, randomSalt, seal } from '../src/lib/etm/crypto.ts'
import {
  lastFullMonth,
  monthEndVariance,
  refreshSnapshotActuals,
  snapshotFromResult,
  snapshotId,
  withHouseholdContribution,
} from '../src/lib/forecast/snapshot.ts'
import { buildChatSnapshot } from '../src/lib/forecast/chatSnapshot.ts'
import { formatEtmChatSnapshot } from '../src/lib/etmChat.ts'
import { withForecastDefaults, type ForecastConfig, type ForecastSnapshot } from '../src/lib/forecast/types.ts'
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
  withCategoryTypicalMonths,
  withCategoryTypeOverride,
  withIgnoredCompare,
  withVacationTag,
} from '../src/lib/forecast/universe.ts'
import { parseMonarchCsv, type MonarchRow } from '../src/lib/etm/monarch.ts'
import { aggregate } from '../src/lib/etm/aggregate.ts'
import { monthPeriod, periodLabel } from '../src/lib/etm/period.ts'
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
const marchMix = forecastMix(march!)
check('March mix totals the forecast column', marchMix.total === march?.calendar, `mix ${marchMix.total} calendar ${march?.calendar}`)
check(
  'March names Harbor Dues as every-month',
  marchMix.monthly.some((line) => line.key === nameKey('Harbor Dues') && line.amount === 400),
)
check(
  'March puts Dock Club with the lumpy lines',
  marchMix.lumpy.some((line) => line.key === nameKey('Dock Club') && line.amount === 180),
)
check('April mix does not place Dock Club', forecastMix(april!).lumpy.every((line) => line.key !== nameKey('Dock Club')))
check(
  'overlay lines are the irregulars, smeared',
  result.cad.household.overlay.lines.some((line) => line.key === nameKey('Engine Repair') && line.share === 100),
)
check(
  'overlay line shares add to window total / N',
  near(
    result.cad.household.overlay.lines.reduce((sum, line) => sum + line.share, 0),
    IRREGULAR_TOTAL / N24,
  ),
)
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
const decMix = forecastMix(decAfter!, placed.knownFutures)
check(
  'December mix lists the pinned repair',
  decMix.pinned.some((line) => line.key === nameKey('Engine Repair') && line.amount === PLACE),
)
check(
  'December mix keeps the pin comment',
  decMix.pinned.some((line) => line.key === nameKey('Engine Repair') && line.notes === 'booked'),
)
check('December mix totals the forecast column', decMix.total === decAfter?.calendar, `mix ${decMix.total} calendar ${decAfter?.calendar}`)

const planOnly = withForecastDefaults({
  window: 24,
  knownFutures: [
    {
      id: 'basket-plan',
      category: 'Market Basket',
      amount: 250,
      month: '2026-12',
      recurrence: 'once',
      series: 'household',
      notes: 'will hit plan',
      addsTo: 'plan',
    },
  ],
})
const planOnlyResult = forecast(transactions, budget, planOnly, ASOF)
const decPlanOnly = monthPoint(planOnlyResult, '2026-12')
const decPlanOnlyMix = forecastMix(decPlanOnly!, planOnly.knownFutures)
check(
  'a Plan vs forecast pin raises December Plan only',
  decPlanOnly?.plan === TYPICAL + 250 && decPlanOnly?.calendar === decBefore?.calendar,
  `plan ${decPlanOnly?.plan} calendar ${decPlanOnly?.calendar} was ${decBefore?.calendar}`,
)
check(
  'a Plan vs forecast pin does not shrink the overlay',
  near(planOnlyResult.cad.household.overlay.monthly, OVERLAY),
)
check(
  'a Plan vs forecast pin is listed on Plan, not in the Forecast mix',
  decPlanOnlyMix.onPlan.some((line) => line.key === nameKey('Market Basket') && line.amount === 250) &&
    decPlanOnlyMix.pinned.every((line) => line.key !== nameKey('Market Basket')),
)
check(
  'Plan-only pins are not in the Forecast mix total',
  decPlanOnlyMix.total === decPlanOnly?.calendar,
  `mix ${decPlanOnlyMix.total} calendar ${decPlanOnly?.calendar}`,
)

console.log('\n=== Current-month remainder ===')
const current = result.cad.household.currentMonth
check('August actual to date is 1280 (dues + basket + pharmacy + posted insurance)', current.actualToDate === 1280, `got ${current.actualToDate}`)
check('posted Harbor Insurance is not left as a remainder', current.postedTypicalKeys.includes(nameKey('Harbor Insurance')))
check('forecast to month-end does not double-count the posted annual', current.forecastEom === 1480, `got ${current.forecastEom}`)
check('Market Basket remainder is 200', current.remain === 200, `got ${current.remain}`)
check(
  'the leftover list adds up to remain',
  round(current.remainLines.reduce((sum, line) => sum + line.remain, 0)) === current.remain,
)
check('Market Basket is named in the leftover list', current.remainLines.some((line) => line.key === nameKey('Market Basket') && line.remain === 200))

console.log('\n=== Plan vs forecast by category ===')
const compare = current.planVsForecast
const duesRow = compare.find((row) => row.key === nameKey('Harbor Dues'))
const insuranceRow = compare.find((row) => row.key === nameKey('Harbor Insurance'))
const absDeltas = compare.map((row) => Math.abs(row.delta))
check('August lists every line with a plan or a forecast', compare.length >= 4, `${compare.length} rows`)
check(
  'sorted by largest absolute difference first',
  compare[0]?.key === nameKey('Harbor Insurance') && compare[0]?.delta === 600,
  `first ${compare[0]?.label} ${compare[0]?.delta}`,
)
check(
  'absolute differences are non-increasing',
  absDeltas.every((value, i) => i === 0 || absDeltas[i - 1]! >= value),
)
check('Harbor Dues plan is the typical-month line', duesRow?.plan === 400, `plan ${duesRow?.plan}`)
check(
  'Harbor Dues forecast to month-end is actual plus leftover',
  duesRow?.forecast === 400 && duesRow?.delta === 0,
  `forecast ${duesRow?.forecast}`,
)
check(
  'Harbor Insurance has no plan line, so the posted 600 is the whole difference',
  insuranceRow?.plan === 0 && insuranceRow?.forecast === 600 && insuranceRow?.delta === 600,
)
check(
  'the current-month calendar point uses the same month-end comparison',
  (monthPoint(result, '2026-08')?.planVsForecast[0]?.delta ?? 0) === 600,
)

function fxTx(id: string, date: string, category: string, amount: number): Transaction {
  return {
    id,
    date,
    merchant: id,
    originalStatement: '',
    notes: '',
    amount,
    currency: 'CAD',
    accountId: 'cad',
    monarchAccount: '',
    category,
    groupId: groupForCategory(category),
    internal: false,
    tags: [],
    owner: 'Sam',
    reviewed: true,
    source: 'monarch',
    importBatchId: 'fixture',
  }
}

const coffeeHist = ['01', '02', '03', '04', '05', '06', '07'].map((mm, i) =>
  fxTx(`coffee-${i}`, `2025-${mm}-10`, 'Pier Coffee', -100),
)
const withCoffee = forecast(
  [...transactions, ...coffeeHist, fxTx('coffee-aug', '2026-08-12', 'Pier Coffee', -40)],
  budget,
  base,
  ASOF,
)
const coffee = cat(withCoffee, 'Pier Coffee')
const coffeeMonth = withCoffee.cad.household.currentMonth
check('an established irregular is not low sample', coffee?.type === 'irregular' && coffee?.lowSample === false, `${coffee?.type} low=${coffee?.lowSample}`)
check('when-present for Pier Coffee is 100', coffee?.meanPresent === 100, `${coffee?.meanPresent}`)
check(
  'in-progress irregular finishes toward when-present',
  coffeeMonth.remain === 260,
  `got ${coffeeMonth.remain}`,
)
check(
  'the leftover list names the in-progress irregular',
  coffeeMonth.remainLines.some(
    (line) => line.key === nameKey('Pier Coffee') && line.remain === 60 && line.reason === 'in-progress-irregular',
  ),
)

const coffeeHistoryOnly = forecast([...transactions, ...coffeeHist], budget, base, ASOF)
check(
  'an unposted irregular still adds no remainder',
  coffeeHistoryOnly.cad.household.currentMonth.remain === 200,
  `got ${coffeeHistoryOnly.cad.household.currentMonth.remain}`,
)

const withLantern = forecast(
  [...transactions, fxTx('lan-aug', '2026-08-12', 'Lantern App', -10)],
  budget,
  base,
  ASOF,
)
check(
  'a low-sample irregular does not invent a remainder even if it has posted',
  withLantern.cad.household.currentMonth.remain === 200,
  `got ${withLantern.cad.household.currentMonth.remain}`,
)

const fuelHist = ['2025-01', '2025-06', '2025-07', '2025-08', '2026-01', '2026-06', '2026-07'].map(
  (month, i) => fxTx(`fuel-${i}`, `${month}-10`, 'Dock Fuel', -300),
)
const withFuel = forecast(
  [...transactions, ...fuelHist, fxTx('fuel-aug', '2026-08-12', 'Dock Fuel', -80)],
  budget,
  base,
  ASOF,
)
const fuel = cat(withFuel, 'Dock Fuel')
const fuelMonth = withFuel.cad.household.currentMonth
check(
  'Dock Fuel classifies as seasonal in driving months including August',
  fuel?.type === 'seasonal' && fuel.typicalMonths.includes(8) && fuel.meanPresent === 300,
  `${fuel?.type} months ${fuel?.typicalMonths} present ${fuel?.meanPresent}`,
)
check(
  'a posted seasonal finishes toward when-present, not the first fill-up',
  fuelMonth.remainLines.some(
    (line) =>
      line.key === nameKey('Dock Fuel') &&
      line.remain === 220 &&
      line.typical === 300 &&
      line.reason === 'in-progress-irregular',
  ),
)
check(
  'forecast to month-end for that seasonal is when-present',
  fuelMonth.planVsForecast.some(
    (row) => row.key === nameKey('Dock Fuel') && row.forecast === 300 && row.plan === 0,
  ),
)
check(
  'a posted seasonal still in progress is not listed as already complete',
  !fuelMonth.postedTypicalKeys.includes(nameKey('Dock Fuel')),
)

console.log('\n=== Type override ===')
const repairKey = nameKey('Engine Repair')
const seasonalRepair = withCategoryTypeOverride(base, repairKey, 'seasonal')
check(
  'a type-only override does not freeze typical months',
  seasonalRepair.categoryOverrides[repairKey]?.type === 'seasonal' &&
    seasonalRepair.categoryOverrides[repairKey]?.typicalMonths == null,
)
const seasonalResult = forecast(transactions, budget, seasonalRepair, ASOF)
const seasonalCat = cat(seasonalResult, 'Engine Repair')
check(
  'overriding irregular to seasonal uses the months it was present',
  seasonalCat?.type === 'seasonal' &&
    seasonalCat.suggestedType === 'irregular' &&
    seasonalCat.overridden &&
    seasonalCat.typicalMonths.join() === '1',
)
check(
  'January then places the seasonal amount',
  (monthPoint(seasonalResult, '2027-01')?.byCategory.find((c) => c.key === repairKey)?.forecast ?? 0) === 2400,
)
check(
  'September still does not place it',
  !monthPoint(seasonalResult, '2026-09')?.byCategory.some((c) => c.key === repairKey && c.forecast > 0),
)
check(
  'the seasonal override does not raise the monthly plan',
  monthPoint(seasonalResult, '2026-09')?.plan === TYPICAL,
)
check(
  'leaving irregular shrinks the overlay by the window total',
  near(seasonalResult.cad.household.overlay.monthly, (IRREGULAR_TOTAL - 2400) / N24),
  `got ${seasonalResult.cad.household.overlay.monthly}`,
)

const relocated = withCategoryTypicalMonths(seasonalRepair, repairKey, [1, 6, 7, 8, 9, 10, 11, 12])
const relocatedResult = forecast(transactions, budget, relocated, ASOF)
check(
  'typical-month override places the amount on those months only',
  (monthPoint(relocatedResult, '2026-09')?.byCategory.find((c) => c.key === repairKey)?.forecast ?? 0) === 2400 &&
    !monthPoint(relocatedResult, '2027-02')?.byCategory.some((c) => c.key === repairKey && c.forecast > 0),
)
check(
  'clearing the override returns to automatic',
  cat(forecast(transactions, budget, withCategoryTypeOverride(relocated, repairKey, 'auto'), ASOF), 'Engine Repair')
    ?.type === 'irregular',
)

console.log('\n=== Plan prior and age-aware classification ===')
const lookback24 = lookbackMonths(ASOF, 24, '2024-08')
const twoHits = lookback24.map((month) => (month === '2026-06' || month === '2026-07' ? 90 : 0))
const threeHits = lookback24.map((month) =>
  month === '2026-05' || month === '2026-06' || month === '2026-07' ? 40 : 0,
)
const twoClass = classifyCategory({ key: 'pierpermit', label: 'Pier Permit', values: twoHits }, lookback24)
const threeClass = classifyCategory({ key: 'docksoap', label: 'Dock Soap', values: threeHits }, lookback24)
check('two months since debut stay emerging', twoClass.type === 'irregular' && twoClass.lowSample)
check(
  'three consecutive months since debut classify as monthly, not against the full 24',
  threeClass.type === 'predictable-monthly' && threeClass.lowSample === false,
  `${threeClass.type} low=${threeClass.lowSample}`,
)

const withLine = (name: string, amount: number): Budget => ({
  ...budget,
  expenses: [
    ...budget.expenses,
    { id: nameKey(name), name, groupId: 'home', amount, essential: false },
  ],
})

const permitHist = ['2026-06-10', '2026-07-10'].map((date, i) => fxTx(`permit-${i}`, date, 'Pier Permit', -90))
const permitBudget = withLine('Pier Permit', 90)
const withPermit = forecast([...transactions, ...permitHist], permitBudget, base, ASOF)
const permitCat = cat(withPermit, 'Pier Permit')
const permitSep = monthPoint(withPermit, '2026-09')?.byCategory.find((row) => row.key === nameKey('Pier Permit'))
check('a Budget line with two months of history uses the plan as prior', permitCat?.usedPlanPrior === true)
check('September places the Pier Permit plan', permitSep?.forecast === 90 && permitSep?.source === 'monthly')
check(
  'plan-backed emerging is not smeared into the overlay',
  !withPermit.cad.household.overlay.lines.some((line) => line.key === nameKey('Pier Permit')),
)
check(
  'current-month leftover for a plan-backed line is plan minus spent',
  withPermit.cad.household.currentMonth.remainLines.some(
    (line) => line.key === nameKey('Pier Permit') && line.remain === 90 && line.reason === 'monthly',
  ),
)
check(
  'usesPlanPrior matches the category flag',
  permitCat != null && usesPlanPrior(permitCat, 90) === true,
)

const soapHist = ['2026-05-10', '2026-06-10', '2026-07-10'].map((date, i) =>
  fxTx(`soap-${i}`, date, 'Dock Soap', -40),
)
const soapBudget = withLine('Dock Soap', 55)
const withSoap = forecast([...transactions, ...soapHist], soapBudget, base, ASOF)
const soapCat = cat(withSoap, 'Dock Soap')
const soapSep = monthPoint(withSoap, '2026-09')?.byCategory.find((row) => row.key === nameKey('Dock Soap'))
check('three consecutive months on a Budget line use history, not the plan', soapCat?.usedPlanPrior === false)
check(
  'September places the history likely for Dock Soap',
  soapSep?.forecast === 40 && soapCat?.type === 'predictable-monthly',
  `forecast ${soapSep?.forecast} type ${soapCat?.type}`,
)

const lightBudget = withLine('Wharf Light', 25)
const withLight = forecast(transactions, lightBudget, base, ASOF)
const lightCat = cat(withLight, 'Wharf Light')
const lightSep = monthPoint(withLight, '2026-09')?.byCategory.find((row) => row.key === nameKey('Wharf Light'))
check('a Budget line with no postings still appears', lightCat?.usedPlanPrior === true)
check('September places the Wharf Light plan', lightSep?.forecast === 25 && lightSep?.source === 'monthly')
check(
  'current month holds the unused Wharf Light plan as leftover',
  withLight.cad.household.currentMonth.remainLines.some(
    (line) => line.key === nameKey('Wharf Light') && line.remain === 25,
  ),
)

const permitForced = forecast(
  [...transactions, ...permitHist],
  permitBudget,
  withCategoryTypeOverride(base, nameKey('Pier Permit'), 'irregular'),
  ASOF,
)
check(
  'an irregular override on a Budget line does not force the plan onto the calendar',
  cat(permitForced, 'Pier Permit')?.usedPlanPrior === false &&
    !monthPoint(permitForced, '2026-09')?.byCategory.some((row) => row.key === nameKey('Pier Permit') && row.forecast > 0),
)
check(
  'Lantern App without a Budget line stays overlay-only',
  lantern?.type === 'irregular' && lantern.lowSample && lantern.usedPlanPrior === false,
)

console.log('\n=== Coverage (9 of 10, vacation ignored) ===')
check('vacation goal is matched by name', result.vacationGoal.status === 'matched')
check('household committed excludes the 2000 vacation contribution', result.coverage.householdCommitted === 400, `got ${result.coverage.householdCommitted}`)
check('coverage uses a 90% bar', result.coverage.coverageTarget === 0.9)
check('household goals are funded at 9-of-10 on this fixture', result.coverage.funded && result.coverage.coverage >= 0.9, `coverage ${(result.coverage.coverage * 100).toFixed(1)}%`)

console.log('\n=== Vacation series ===')
const july = result.cad.vacation.months.find((m) => m.month === '2026-07')
check('July 2026 is a vacation-spend month', july?.isTravel === true)
const sep = result.cad.vacation.months.find((m) => m.month === '2026-09')
const sweep = vacationSweep({
  income: 2500,
  likelySetAside: result.cad.household.setAside.likely,
  householdCommitted: 400,
})
check('the vacation sweep is leftover after household life and household goals', result.cad.vacation.monthlyContribution === sweep, `got ${result.cad.vacation.monthlyContribution}, expected ${sweep}`)
check('July still takes the savings sweep', july?.contribution === sweep, `got ${july?.contribution}`)
check('September takes the same sweep', (sep?.contribution ?? 0) === sweep)
check('vacation spend does not pause the sweep', result.cad.vacation.currentMonthPaused === false)

const prepaidRow: Transaction = {
  id: 'fx-prepay',
  date: '2026-08-10',
  merchant: 'January Lodge',
  originalStatement: 'JANUARY LODGE',
  notes: '',
  amount: -2200,
  currency: 'CAD',
  accountId: 'cad',
  monarchAccount: 'Chequing (...1001)',
  category: 'Trip Lodging',
  groupId: groupForCategory('Trip Lodging'),
  internal: false,
  tags: ['Reimbursable: Vacation Account'],
  owner: 'Sam',
  reviewed: true,
  source: 'monarch',
  importBatchId: 'fixture',
}
const prepaid = forecast([...transactions, prepaidRow], budget, base, ASOF)
const aug = prepaid.cad.vacation.months.find((m) => m.month === '2026-08')
check(
  'an August prepayment still takes the savings sweep',
  (aug?.actual ?? 0) >= 2200 && aug?.contribution === prepaid.cad.vacation.monthlyContribution && prepaid.cad.vacation.currentMonthPaused === false,
  `actual ${aug?.actual} contribution ${aug?.contribution}`,
)
const pinned = forecast([...transactions, prepaidRow], budget, {
  ...base,
  knownFutures: [
    {
      id: 'cruise',
      category: 'Cruise deposit',
      amount: 1800,
      month: '2027-01',
      recurrence: 'once',
      series: 'vacation',
      notes: '',
    },
  ],
}, ASOF)
const jan = pinned.cad.vacation.months.find((m) => m.month === '2027-01')
check('a January pin still takes the sweep', jan?.contribution === pinned.cad.vacation.monthlyContribution)
check(
  'January is the pin, not the August prepayment added again',
  (jan?.forecast ?? 0) === 1800,
  `got ${jan?.forecast}`,
)

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
check('an omitted compare-ignore list is empty', Object.keys(withForecastDefaults({}).ignoredCompare).length === 0)
const ignoredGas = withIgnoredCompare(base, '2026-09', nameKey('Gas'), true)
check(
  'ignoring a compare line is stored on that month',
  ignoredGas.ignoredCompare['2026-09']?.join() === nameKey('Gas'),
)
check(
  'clearing an ignore removes the month key',
  withIgnoredCompare(ignoredGas, '2026-09', nameKey('Gas'), false).ignoredCompare['2026-09'] == null,
)
const afterIgnore = withCompareIgnores(
  1000,
  1200,
  [
    { key: nameKey('Gas'), plan: 350, forecast: 304 },
    { key: nameKey('Rent'), plan: 650, forecast: 896 },
  ],
  [nameKey('Gas')],
)
check('ignoring a line leaves Plan unchanged', afterIgnore.plan === 1000)
check(
  'ignoring a line treats it as hitting Plan, so Forecast moves by the gap',
  afterIgnore.forecast === 1246,
  `got ${afterIgnore.forecast}`,
)
const afterTrend = withCompareIgnores(
  1000,
  1200,
  [{ key: nameKey('Restaurants'), plan: 200, forecast: 450 }],
  [nameKey('Restaurants')],
)
check(
  'ignoring a line above Plan drops Forecast by the overage',
  afterTrend.plan === 1000 && afterTrend.forecast === 950,
)
check(
  'an empty ignore list leaves plan and forecast',
  withCompareIgnores(1000, 1200, [{ key: nameKey('Gas'), plan: 350, forecast: 304 }], []).forecast === 1200,
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

console.log('\n=== Snapshots and month-end variance ===')
const currentMonth = ASOF.slice(0, 7)
const prior = lastFullMonth(ASOF)
check('snapshot ids are forecast-snap-YYYY-MM', snapshotId('2026-07') === 'forecast-snap-2026-07')
check('last full month before mid-August is July', prior === '2026-07')
const snap = snapshotFromResult(result, currentMonth)
check('current-month snapshot uses the calendar column, not a remainder', snap.month === currentMonth && snap.calendar === (monthPoint(result, currentMonth)?.calendar ?? -1))
check('snapshot byCategory is present', snap.byCategory.length > 0)
const refreshed = refreshSnapshotActuals(snap, {
  ...snap,
  asOf: '2026-08-31',
  calendar: snap.calendar + 999,
  actual: 12,
  byCategory: snap.byCategory.map((row) => ({ ...row, forecast: row.forecast + 50, actual: 1 })),
})
check('refreshing a snapshot keeps the stored forecast', refreshed.calendar === snap.calendar && refreshed.byCategory[0]?.forecast === snap.byCategory[0]?.forecast)
check('refreshing a snapshot updates actuals', refreshed.actual === 12 && refreshed.asOf === '2026-08-31')
const julyPoint = monthPoint(result, prior)
const storedVariance = monthEndVariance({
  month: prior,
  actual: julyPoint?.actual ?? 0,
  actualByCategory: julyPoint?.byCategory ?? [],
  snapshot: {
    ...snap,
    month: prior,
    calendar: (julyPoint?.actual ?? 0) * 1.2 || 100,
    byCategory: (julyPoint?.byCategory ?? []).map((row) => ({ key: row.key, forecast: row.forecast })),
  },
})
check('a stored snapshot is labelled stored', storedVariance?.source === 'stored')
const reconstructedVariance = monthEndVariance({
  month: prior,
  actual: julyPoint?.actual ?? 0,
  actualByCategory: julyPoint?.byCategory ?? [],
  reconstructed: {
    forecast: julyPoint?.calendar ?? 0,
    byCategory: (julyPoint?.byCategory ?? []).map((row) => ({
      key: row.key,
      label: row.label,
      forecast: row.forecast,
    })),
  },
})
check('a walk-forward without a snapshot is labelled reconstructed', reconstructedVariance?.source === 'reconstructed')
const insideVariance = monthEndVariance({
  month: prior,
  actual: 100,
  actualByCategory: [],
  snapshot: { ...snap, month: prior, calendar: 100, byCategory: [] },
})
check('equal actual and calendar sit inside ±5%', insideVariance?.outsideControlWindow === false)
const walkedJuly = walked.months.find((row) => row.month === prior)
check('walk-forward still describes last month by category', (walkedJuly?.byCategory.length ?? 0) > 0)
const applied = withHouseholdContribution(budget.goals, 250, 'vac')
const vacation = applied.find((goal) => goal.id === 'vac')
const emergency = applied.find((goal) => goal.id === 'emergency')
check('applying a household contribution leaves the vacation goal untouched', vacation?.monthly === 2000)
check('the household goal receives the new contribution', emergency?.monthly === 250)
const sealedSnap = await seal(key, snap)
const openedSnap = await open<ForecastSnapshot>(key, sealedSnap)
check('the right key opens a forecast snapshot', openedSnap.month === snap.month && openedSnap.calendar === snap.calendar)
let wrongSnapRejected = false
try {
  await open(wrongKey, sealedSnap)
} catch {
  wrongSnapRejected = true
}
check('a wrong key cannot read a forecast snapshot', wrongSnapRejected)

console.log('\n=== Chat snapshot (derived totals, never the ledger) ===')
const august = monthPeriod('2026-08')
const augustActuals = aggregate(transactions, august)
const chatSnap = buildChatSnapshot({
  budget,
  actuals: augustActuals,
  periodLabel: periodLabel(august),
  forecast: result,
  transactions,
})
const chatText = formatEtmChatSnapshot(chatSnap)
const fixtureMerchants = [
  'Pier Housekeeping',
  'Cedar Market',
  'Cove Pharmacy',
  'Nimbus Software',
  'Coast Mutual',
  'Pebble Gifts',
  'Chequing (...1001)',
  'US Card (...7788)',
]
check('chat snapshot names Budget-tab actuals', chatText.includes('Budget-tab actuals'))
check('chat snapshot names Forecast household', chatText.includes('Forecast household'))
check('chat snapshot names Forecast vacation', chatText.includes('Forecast vacation'))
check('chat snapshot says the vacation sweep is never paused', chatText.includes('never paused'))
check('chat snapshot names Reimbursable-tab actuals', chatText.includes('Reimbursable-tab actuals'))
check(
  'chat snapshot includes Reimbursable buckets, not merchant rows',
  chatText.includes('Healthcare Account') &&
    chatText.includes('Business Account') &&
    chatText.includes('Vacation Account') &&
    !chatText.includes('Cove Pharmacy') &&
    !chatText.includes('Lakeside Inn'),
)
check(
  'chat snapshot includes Reimbursable months before as-of August',
  (() => {
    const line = chatText.split('\n').find((row) => row.includes('Bucket Healthcare Account')) ?? ''
    return line.includes('2026-07') || line.includes('2026-06')
  })(),
)
check('chat snapshot names overlay as not the Forecast column', /overlay.*not the Forecast column/i.test(chatText))
check('chat snapshot names the typical-month plan beside set-aside', chatText.includes('Typical-month plan'))
check(
  'chat snapshot has no merchant, account, or statement strings',
  fixtureMerchants.every((name) => !chatText.includes(name)),
)
check('chat snapshot includes Harbor Dues as a category, not a merchant row', chatText.includes('Harbor Dues'))
check(
  'chat snapshot includes Harbor Dues monthly actuals before as-of August',
  (() => {
    const line = chatText.split('\n').find((row) => row.includes('[forecast-household, CAD] Harbor Dues')) ?? ''
    return line.includes('2026-07') && /window/i.test(line)
  })(),
)
check(
  'chat snapshot includes Market Basket monthly actuals before as-of August',
  (() => {
    const line = chatText.split('\n').find((row) => row.includes('[forecast-household, CAD] Market Basket')) ?? ''
    return line.includes('2026-06') || line.includes('2026-07')
  })(),
)
check('USD household is named and not added into CAD', /Forecast household \(USD\)/.test(chatText) && chatText.includes('Cloud Software'))

console.log('\n=== Main bundle stays clear of forecasting ===')
const appSource = readFileSync('src/App.tsx', 'utf8')
check(
  'App.tsx does not import the forecast engine or panel',
  !appSource.includes('lib/forecast') && !appSource.includes('ForecastPanel') && !appSource.includes('chatSnapshot'),
)
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const versionSource = readFileSync('src/lib/version.ts', 'utf8')
check('package.json version is set', typeof pkg.version === 'string' && pkg.version.length > 0)
check(
  'APP_VERSION matches package.json',
  versionSource.includes(`'${pkg.version}'`) || versionSource.includes(`"${pkg.version}"`),
)

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll forecast checks passed.')
