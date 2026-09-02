import { totalExpenses, totalGoalContributions, totalIncome } from '../budget'
import type { Budget } from '../types'
import type { Currency, Transaction } from '../etm/types'
import {
  classifyCategories,
  mean,
  percentile,
  roundCents,
  type CategorySeries,
} from './classify'
import type {
  CategoryForecast,
  CoverageResult,
  CurrencyForecast,
  CurrentMonthView,
  DoubleCountWarning,
  ForecastConfig,
  ForecastMix,
  ForecastMixLine,
  ForecastResult,
  HouseholdForecast,
  KnownFuture,
  MonthCategoryAmount,
  MonthPoint,
  OverlayBreakdown,
  RemainLine,
  SeriesId,
  SetAside,
  TimelineStack,
  VarianceRow,
  VacationForecast,
  VacationGoalMatch,
  VacationMonth,
} from './types'
import { withForecastDefaults } from './types'
import {
  DEFAULT_REIMBURSABLE_PARENT,
  HOUSEHOLD_STACK_KEY,
  householdBucketFor,
  nameKey,
  normalizeTag,
  signedSpend,
  splitUniverse,
} from './universe'

export const CONTROL_WINDOW = 0.05
const TRAVEL_THRESHOLD = 0.005

/** Expected monthly savings swept into the vacation pot. Never paused. */
export function vacationSweep(args: {
  income: number
  likelySetAside: number
  householdCommitted: number
}): number {
  return roundCents(Math.max(0, args.income - args.likelySetAside - args.householdCommitted))
}

export function addMonths(month: string, delta: number): string {
  const abs = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta
  const year = Math.floor(abs / 12)
  const mm = abs - year * 12 + 1
  return `${year}-${String(mm).padStart(2, '0')}`
}

export function lookbackMonths(
  asOf: string,
  window: ForecastConfig['window'],
  earliestMonth: string | undefined,
): string[] {
  const end = addMonths(asOf.slice(0, 7), -1)
  if (!earliestMonth) return []
  const first = earliestMonth.slice(0, 7)
  if (first > end) return []
  let start = window === 'all' ? first : addMonths(end, -(window - 1))
  if (start < first) start = first
  const months: string[] = []
  for (let month = start; month <= end; month = addMonths(month, 1)) months.push(month)
  return months
}

export function timelineMonths(asOf: string): { past: string[]; rest: string[] } {
  const current = asOf.slice(0, 7)
  const lastFull = addMonths(current, -1)
  const past: string[] = []
  for (let i = 11; i >= 0; i--) past.push(addMonths(lastFull, -i))
  const rest: string[] = []
  for (let i = 0; i < 12; i++) rest.push(addMonths(current, i))
  return { past, rest }
}

export function windowLabel(window: ForecastConfig['window'], available: number): string {
  if (window === 'all') return `${available} months of history`
  if (available < window) return `${available} months of history, not ${window}`
  return `${window}-month window`
}

export function controlGap(forecast: number, plan: number): number {
  if (plan === 0) return forecast === 0 ? 0 : Number.POSITIVE_INFINITY
  return (forecast - plan) / plan
}

export function isOutsideControlWindow(forecast: number, plan: number): boolean {
  const gap = controlGap(forecast, plan)
  if (!Number.isFinite(gap)) return forecast !== 0
  return Math.abs(gap) > CONTROL_WINDOW
}

/** Take ignored Plan vs forecast gaps out of Forecast. Plan is unchanged. */
export function withCompareIgnores(
  plan: number,
  forecast: number,
  compare: Array<{ key: string; plan: number; forecast: number }>,
  ignoredKeys: string[],
): { plan: number; forecast: number } {
  const ignored = new Set(ignoredKeys)
  let deltaOff = 0
  for (const row of compare) {
    if (!ignored.has(row.key)) continue
    deltaOff += row.forecast - row.plan
  }
  return { plan, forecast: roundCents(forecast - deltaOff) }
}

/** Dated costs land on Forecast; Plan vs forecast pins raise Plan only. */
export function pinAddsToForecast(future: Pick<KnownFuture, 'addsTo'>): boolean {
  return future.addsTo !== 'plan'
}

export function inflate(amount: number, monthsAhead: number, annualPercent: number): number {
  if (annualPercent === 0 || monthsAhead <= 0 || amount === 0) return amount
  return amount * (1 + annualPercent / 100) ** (monthsAhead / 12)
}

export function monthOfKnownFuture(future: KnownFuture, month: string): boolean {
  if (future.recurrence === 'once') return future.month === month
  return month.slice(5, 7) === future.month.slice(5, 7) && month >= future.month
}

function earliestMonth(transactions: Transaction[]): string | undefined {
  let min: string | undefined
  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7)
    if (!min || month < min) min = month
  }
  return min
}

function commonest(spellings: Map<string, number>): string {
  let best = ''
  let count = -1
  for (const [name, n] of spellings) {
    if (n > count || (n === count && name < best)) {
      best = name
      count = n
    }
  }
  return best
}

interface CategoryActuals {
  key: string
  label: string
  byMonth: Map<string, number>
}

function accumulate(transactions: Transaction[], currency: Currency): CategoryActuals[] {
  const map = new Map<string, CategoryActuals & { spellings: Map<string, number> }>()
  for (const transaction of transactions) {
    if (transaction.currency !== currency) continue
    const key = nameKey(transaction.category)
    let row = map.get(key)
    if (!row) {
      row = { key, label: transaction.category, byMonth: new Map(), spellings: new Map() }
      map.set(key, row)
    }
    const month = transaction.date.slice(0, 7)
    row.byMonth.set(month, (row.byMonth.get(month) ?? 0) + signedSpend(transaction.amount))
    row.spellings.set(transaction.category, (row.spellings.get(transaction.category) ?? 0) + 1)
  }
  return [...map.values()].map((row) => ({
    key: row.key,
    label: commonest(row.spellings),
    byMonth: row.byMonth,
  }))
}

function toSeries(rows: CategoryActuals[], months: string[], keepKeys: Set<string> = new Set()): CategorySeries[] {
  return rows
    .map((row) => ({
      key: row.key,
      label: row.label,
      values: months.map((month) => row.byMonth.get(month) ?? 0),
    }))
    .filter((series) => series.values.some((value) => value !== 0) || keepKeys.has(series.key))
}

function spendInMonth(rows: CategoryActuals[], key: string, month: string): number {
  return rows.find((row) => row.key === key)?.byMonth.get(month) ?? 0
}

function totalInMonth(rows: CategoryActuals[], month: string): number {
  return rows.reduce((sum, row) => sum + (row.byMonth.get(month) ?? 0), 0)
}

interface BucketPart {
  label: string
  amount: number
}

interface BucketShare {
  key: string
  label: string
  share: number
}

function addBucketPart(parts: Map<string, BucketPart>, key: string, label: string, amount: number) {
  if (Math.abs(amount) < 0.0005) return
  const prev = parts.get(key)
  parts.set(key, { label: prev?.label ?? label, amount: (prev?.amount ?? 0) + amount })
}

function orderedStack(parts: Map<string, BucketPart>, allowList: string[]): TimelineStack[] {
  const extras = [...parts.keys()].filter(
    (key) => key !== HOUSEHOLD_STACK_KEY && !allowList.some((tag) => normalizeTag(tag) === key),
  )
  const keys = [HOUSEHOLD_STACK_KEY, ...allowList.map((tag) => normalizeTag(tag)), ...extras]
  const seen = new Set<string>()
  const stack: TimelineStack[] = []
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    const part = parts.get(key)
    if (!part || Math.abs(part.amount) < 0.005) continue
    stack.push({ key, label: part.label, amount: roundCents(part.amount) })
  }
  return stack
}

function actualBucketParts(
  transactions: Transaction[],
  currency: Currency,
  month: string,
  allowList: string[],
  parent: string,
): Map<string, BucketPart> {
  const parts = new Map<string, BucketPart>()
  for (const transaction of transactions) {
    if (transaction.currency !== currency) continue
    if (transaction.date.slice(0, 7) !== month) continue
    const bucket = householdBucketFor(transaction.tags, allowList, parent)
    addBucketPart(parts, bucket.key, bucket.label, signedSpend(transaction.amount))
  }
  return parts
}

function categoryBucketMix(
  transactions: Transaction[],
  currency: Currency,
  lookback: string[],
  allowList: string[],
  parent: string,
): Map<string, BucketShare[]> {
  const inWindow = new Set(lookback)
  const totals = new Map<string, Map<string, BucketPart>>()
  for (const transaction of transactions) {
    if (transaction.currency !== currency) continue
    const month = transaction.date.slice(0, 7)
    if (!inWindow.has(month)) continue
    const category = nameKey(transaction.category)
    const bucket = householdBucketFor(transaction.tags, allowList, parent)
    let row = totals.get(category)
    if (!row) {
      row = new Map()
      totals.set(category, row)
    }
    addBucketPart(row, bucket.key, bucket.label, signedSpend(transaction.amount))
  }
  const mix = new Map<string, BucketShare[]>()
  for (const [category, parts] of totals) {
    const sum = [...parts.values()].reduce((total, part) => total + part.amount, 0)
    if (sum <= 0) continue
    mix.set(
      category,
      [...parts.entries()].map(([key, part]) => ({
        key,
        label: part.label,
        share: part.amount / sum,
      })),
    )
  }
  return mix
}

function applyCategoryMix(
  parts: Map<string, BucketPart>,
  mix: Map<string, BucketShare[]>,
  categoryKey: string,
  amount: number,
) {
  const shares = mix.get(categoryKey)
  if (!shares || shares.length === 0) {
    addBucketPart(parts, HOUSEHOLD_STACK_KEY, 'Household', amount)
    return
  }
  for (const share of shares) {
    addBucketPart(parts, share.key, share.label, amount * share.share)
  }
}

function forecastStackFromCategories(
  byCategory: MonthCategoryAmount[],
  mix: Map<string, BucketShare[]>,
  allowList: string[],
): TimelineStack[] {
  const parts = new Map<string, BucketPart>()
  for (const row of byCategory) applyCategoryMix(parts, mix, row.key, row.forecast)
  return orderedStack(parts, allowList)
}

function currentReadingStack(
  transactions: Transaction[],
  currency: Currency,
  month: string,
  remainLines: RemainLine[],
  mix: Map<string, BucketShare[]>,
  allowList: string[],
  parent: string,
): TimelineStack[] {
  const parts = actualBucketParts(transactions, currency, month, allowList, parent)
  for (const line of remainLines) applyCategoryMix(parts, mix, line.key, line.remain)
  return orderedStack(parts, allowList)
}

function planForCategory(budget: Budget, key: string): number {
  return budget.expenses
    .filter((line) => nameKey(line.name) === key)
    .reduce((sum, line) => sum + (line.amount || 0), 0)
}

const isMonthlyType = (type: CategoryForecast['type']): boolean =>
  type === 'predictable-monthly' || type === 'variable-monthly'

/**
 * A typical-month Budget line means the cost continues. Until history
 * classifies as monthly, the plan stands in for the calendar amount.
 * A type override (annual / seasonal / irregular) still wins.
 */
export function usesPlanPrior(category: CategoryForecast, plan: number): boolean {
  if (!(plan > 0)) return false
  if (isMonthlyType(category.type)) return false
  if (category.overridden) return false
  return true
}

function applyPlanPriors(categories: CategoryForecast[], budget: Budget): void {
  for (const category of categories) {
    const plan = planForCategory(budget, category.key)
    if (!usesPlanPrior(category, plan)) continue
    category.usedPlanPrior = true
    category.likely = roundCents(plan)
    category.setAsideShare = roundCents(plan)
    if (category.high < plan) category.high = roundCents(plan)
    if (category.low === 0 || category.low > plan) category.low = roundCents(plan)
  }
}

/**
 * Plan vs forecast by category. Difference is forecast − plan. Sorted from
 * the largest absolute gap to the smallest.
 */
function planVsForecastRows(
  budget: Budget,
  month: string,
  seriesId: SeriesId,
  categories: CategoryForecast[],
  forecastByKey: Map<string, { label: string; amount: number }>,
  config: ForecastConfig,
): VarianceRow[] {
  if (seriesId !== 'household') return []

  const pinByKey = new Map<string, number>()
  const pinLabel = new Map<string, string>()
  for (const future of futuresFor(config, month, 'household')) {
    const key = nameKey(future.category)
    pinByKey.set(key, (pinByKey.get(key) ?? 0) + future.amount)
    pinLabel.set(key, future.category)
  }

  const keys = new Set<string>()
  for (const line of budget.expenses) keys.add(nameKey(line.name))
  for (const category of categories) keys.add(category.key)
  for (const key of forecastByKey.keys()) keys.add(key)
  for (const key of pinByKey.keys()) keys.add(key)

  const rows: VarianceRow[] = []
  for (const key of keys) {
    const label =
      forecastByKey.get(key)?.label ??
      categories.find((category) => category.key === key)?.label ??
      budget.expenses.find((line) => nameKey(line.name) === key)?.name ??
      pinLabel.get(key) ??
      key
    const plan = roundCents(planForCategory(budget, key) + (pinByKey.get(key) ?? 0))
    const forecastAmt = roundCents(forecastByKey.get(key)?.amount ?? 0)
    if (plan === 0 && forecastAmt === 0) continue
    rows.push({
      key,
      label,
      plan,
      forecast: forecastAmt,
      delta: roundCents(forecastAmt - plan),
    })
  }
  return rows.sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta) || a.label.localeCompare(z.label))
}

function matchVacationGoal(budget: Budget, config: ForecastConfig): VacationGoalMatch {
  if (config.vacationGoalId) {
    const found = budget.goals.find((goal) => goal.id === config.vacationGoalId)
    if (found) {
      return {
        status: 'matched',
        goalId: found.id,
        goalName: found.name,
        monthly: found.monthly,
        current: found.current,
      }
    }
    return { status: 'missing', monthly: 0, current: 0 }
  }
  const matches = budget.goals.filter((goal) => nameKey(goal.name).includes('vacation'))
  if (matches.length === 1) {
    const found = matches[0]!
    return {
      status: 'matched',
      goalId: found.id,
      goalName: found.name,
      monthly: found.monthly,
      current: found.current,
    }
  }
  if (matches.length > 1) return { status: 'ambiguous', monthly: 0, current: 0 }
  return { status: 'missing', monthly: 0, current: 0 }
}

function futuresFor(
  config: ForecastConfig,
  month: string,
  series: SeriesId,
): KnownFuture[] {
  return config.knownFutures.filter(
    (future) => (future.series ?? 'household') === series && monthOfKnownFuture(future, month),
  )
}

function futureTotal(config: ForecastConfig, month: string, series: SeriesId): number {
  return futuresFor(config, month, series).reduce((sum, future) => sum + future.amount, 0)
}

function seasonalAmount(
  category: CategoryForecast,
  series: CategorySeries | undefined,
  months: string[],
  mm: number,
): number {
  if (!series) return category.meanPresent
  const hits = months
    .map((month, i) => (Number(month.slice(5, 7)) === mm ? series.values[i]! : 0))
    .filter((value) => value > 0)
  return hits.length > 0 ? mean(hits) : category.meanPresent
}

function placedAmount(
  category: CategoryForecast,
  series: CategorySeries | undefined,
  months: string[],
  month: string,
  plan = 0,
): { amount: number; source: MonthCategoryAmount['source'] } {
  const mm = Number(month.slice(5, 7))
  if (usesPlanPrior(category, plan)) {
    return { amount: plan, source: 'monthly' }
  }
  if (isMonthlyType(category.type)) {
    return { amount: category.likely, source: 'monthly' }
  }
  if (category.type === 'predictable-annual' && category.typicalMonths.includes(mm)) {
    return { amount: category.likely, source: 'annual' }
  }
  if (category.type === 'seasonal' && category.typicalMonths.includes(mm)) {
    return { amount: seasonalAmount(category, series, months, mm), source: 'seasonal' }
  }
  return { amount: 0, source: 'none' }
}

/** A seasonal month in progress is at least a when-present month — not the first fill-up. */
function seasonalCurrentTarget(expected: number, meanPresent: number, lowSample: boolean): number {
  if (lowSample) return expected
  return Math.max(expected, meanPresent)
}

const pinTotalFor = (placements: KnownFuture[], key: string): number =>
  placements
    .filter(pinAddsToForecast)
    .reduce((sum, future) => (nameKey(future.category) === key ? sum + future.amount : sum), 0)

const byAmount = (a: { amount: number; label: string }, z: { amount: number; label: string }) =>
  Math.abs(z.amount) - Math.abs(a.amount) || a.label.localeCompare(z.label)

/**
 * Split a month’s Forecast column into every-month lines, lumpy lines that
 * land this month, and pins that add to Forecast. Plan-only pins are listed
 * separately and are not in `total`. Pins that sit on a category already in
 * the calendar are taken off that line so the Forecast groups still add.
 */
export function forecastMix(point: MonthPoint, placements: KnownFuture[] = []): ForecastMix {
  const monthly: ForecastMix['monthly'] = []
  const lumpy: ForecastMix['lumpy'] = []
  for (const row of point.byCategory) {
    const pin = pinTotalFor(placements, row.key)
    const amount = roundCents(row.forecast - pin)
    if (Math.abs(amount) < 0.005) continue
    const line = { key: row.key, label: row.label, amount, source: row.source }
    if (row.source === 'monthly') monthly.push(line)
    else if (row.source === 'annual' || row.source === 'seasonal') lumpy.push(line)
  }
  monthly.sort(byAmount)
  lumpy.sort(byAmount)
  const toLine = (future: KnownFuture): ForecastMixLine => ({
    key: nameKey(future.category),
    label: future.category,
    amount: future.amount,
    source: 'known-future',
    placementId: future.id,
    recurrence: future.recurrence,
    notes: future.notes,
  })
  const onForecast = placements.filter((future) => future.amount !== 0 && pinAddsToForecast(future))
  const onPlan = placements.filter((future) => future.amount !== 0 && !pinAddsToForecast(future))
  const pinned = onForecast.map(toLine)
  const planPins = onPlan.map(toLine)
  const total = roundCents(
    monthly.reduce((sum, line) => sum + line.amount, 0) +
      lumpy.reduce((sum, line) => sum + line.amount, 0) +
      pinned.reduce((sum, line) => sum + line.amount, 0),
  )
  return { monthly, lumpy, pinned, onPlan: planPins, total }
}

function overlayIrregulars(categories: CategoryForecast[]): CategoryForecast[] {
  return categories.filter((category) => category.type === 'irregular' && !category.usedPlanPrior)
}

function topIrregularMonths(
  categories: CategoryForecast[],
  series: CategorySeries[],
  months: string[],
  count: number,
): Array<{ key: string; month: string; amount: number }> {
  if (count <= 0) return []
  const cells: Array<{ key: string; month: string; amount: number }> = []
  const byKey = new Map(series.map((item) => [item.key, item]))
  for (const category of overlayIrregulars(categories)) {
    const row = byKey.get(category.key)
    if (!row) continue
    row.values.forEach((amount, i) => {
      if (amount > 0) cells.push({ key: category.key, month: months[i]!, amount })
    })
  }
  return cells.sort((a, z) => z.amount - a.amount).slice(0, count)
}

function overlayFor(
  categories: CategoryForecast[],
  series: CategorySeries[],
  months: string[],
  config: ForecastConfig,
  asOf: string,
  outlierCount: number,
): OverlayBreakdown {
  const n = months.length
  const smear = overlayIrregulars(categories)
  const irregularTotal = smear.reduce((sum, category) => sum + category.windowTotal, 0)
  const excludedOutliers = topIrregularMonths(categories, series, months, outlierCount)
  const afterOutliers = Math.max(
    0,
    irregularTotal - excludedOutliers.reduce((sum, item) => sum + item.amount, 0),
  )
  const irregularKeys = new Set(smear.map((category) => category.key))
  const current = asOf.slice(0, 7)
  let placedNextYear = 0
  for (let i = 0; i < 12; i++) {
    const month = addMonths(current, i)
    for (const future of futuresFor(config, month, 'household')) {
      if (!pinAddsToForecast(future)) continue
      if (irregularKeys.has(nameKey(future.category))) placedNextYear += future.amount
    }
  }
  const unplaced = Math.max(0, afterOutliers - placedNextYear)
  const lines = smear
    .map((category) => ({
      key: category.key,
      label: category.label,
      share: n > 0 ? roundCents(category.windowTotal / n) : 0,
      windowTotal: roundCents(category.windowTotal),
      lastAmount: roundCents(category.lastAmount),
      lowSample: category.lowSample,
    }))
    .filter((line) => line.share !== 0)
    .sort((a, z) => Math.abs(z.share) - Math.abs(a.share) || a.label.localeCompare(z.label))
  return {
    irregularWindowTotal: roundCents(irregularTotal),
    placedNextYear: roundCents(placedNextYear),
    unplaced: roundCents(unplaced),
    monthly: n > 0 ? roundCents(unplaced / n) : 0,
    excludedOutliers: excludedOutliers.map((item) => ({ ...item, amount: roundCents(item.amount) })),
    lines,
  }
}

function setAsideFor(
  categories: CategoryForecast[],
  monthlySpend: number[],
  overlay: OverlayBreakdown,
  lowOverlay: OverlayBreakdown,
  config: ForecastConfig,
  label: string,
): SetAside {
  const fromHistory = categories
    .filter((c) => isMonthlyType(c.type))
    .reduce((sum, c) => sum + c.setAsideShare, 0)
  const fromPlan = categories
    .filter((c) => c.usedPlanPrior)
    .reduce((sum, c) => sum + c.setAsideShare, 0)
  const monthlyLikely = fromHistory + fromPlan
  const lumpyShare = categories
    .filter((c) => (c.type === 'predictable-annual' || c.type === 'seasonal') && !c.usedPlanPrior)
    .reduce((sum, c) => sum + c.setAsideShare, 0)
  const monthlyLow =
    categories.filter((c) => isMonthlyType(c.type)).reduce((sum, c) => sum + c.low, 0) + fromPlan
  const p = config.lumpyMethod === 'percent-buffer' ? config.bufferPercent / 100 : 0
  const lumpyAndOverlay = lumpyShare + overlay.monthly
  const buffer = lumpyAndOverlay * p
  const likely = monthlyLikely + lumpyAndOverlay + buffer
  const low = monthlyLow + lumpyShare + lowOverlay.monthly + (lumpyShare + lowOverlay.monthly) * p
  return {
    likely: roundCents(likely),
    high: roundCents(percentile(monthlySpend, 0.9)),
    low: roundCents(low),
    monthlyLikely: roundCents(monthlyLikely),
    lumpyShare: roundCents(lumpyShare),
    overlay: overlay.monthly,
    buffer: roundCents(buffer),
    windowLabel: label,
  }
}

function gapRows(rows: VarianceRow[], forecastTotal: number, planTotal: number): VarianceRow[] {
  const gap = forecastTotal - planTotal
  if (gap === 0) return []
  return rows
    .filter((row) => (gap > 0 ? row.delta > 0 : row.delta < 0))
    .sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta) || a.label.localeCompare(z.label))
}

function ensureNamedSeries(
  rows: CategoryActuals[],
  extras: Array<{ key: string; label: string }>,
): CategoryActuals[] {
  const seen = new Set(rows.map((row) => row.key))
  const extra = extras.filter((item) => !seen.has(item.key))
  return [
    ...rows,
    ...extra.map((item) => ({ key: item.key, label: item.label, byMonth: new Map<string, number>() })),
  ]
}

function calendarPoint(args: {
  month: string
  kind: MonthPoint['kind']
  categories: CategoryForecast[]
  series: CategorySeries[]
  lookback: string[]
  actuals: CategoryActuals[]
  budget: Budget
  config: ForecastConfig
  asOf: string
  overlay: number
  seriesId: SeriesId
  householdTx: Transaction[]
  currency: Currency
  parentTag: string
  bucketMix: Map<string, BucketShare[]>
}): MonthPoint {
  const {
    month,
    kind,
    categories,
    series,
    lookback,
    actuals,
    budget,
    config,
    asOf,
    overlay,
    seriesId,
    householdTx,
    currency,
    parentTag,
    bucketMix,
  } = args
  const byKey = new Map(series.map((item) => [item.key, item]))
  const monthsAhead = monthDiff(asOf.slice(0, 7), month)
  const byCategory: MonthCategoryAmount[] = []
  let calendar = 0

  for (const category of categories) {
    const planAmt = seriesId === 'household' ? planForCategory(budget, category.key) : 0
    const placed = placedAmount(category, byKey.get(category.key), lookback, month, planAmt)
    const amount = inflate(placed.amount, monthsAhead, config.inflationPercent)
    if (amount !== 0 || spendInMonth(actuals, category.key, month) !== 0) {
      byCategory.push({
        key: category.key,
        label: category.label,
        type: category.type,
        forecast: roundCents(amount),
        actual: roundCents(spendInMonth(actuals, category.key, month)),
        source: placed.source,
      })
    }
    calendar += amount
  }

  const known = futuresFor(config, month, seriesId)
  let onForecast = 0
  let onPlan = 0
  for (const future of known) {
    onPlan += future.amount
    if (!pinAddsToForecast(future)) continue
    const key = nameKey(future.category)
    onForecast += future.amount
    const existing = byCategory.find((item) => item.key === key)
    if (existing) {
      existing.forecast = roundCents(existing.forecast + future.amount)
      existing.source = existing.source === 'none' ? 'known-future' : existing.source
    } else {
      byCategory.push({
        key,
        label: future.category,
        type: 'irregular',
        forecast: roundCents(future.amount),
        actual: roundCents(spendInMonth(actuals, key, month)),
        source: 'known-future',
      })
    }
  }
  calendar += onForecast

  const actual = kind === 'future' ? 0 : totalInMonth(actuals, month)
  const plan = seriesId === 'household' ? totalExpenses(budget) + onPlan : onPlan
  const forecast = roundCents(calendar)
  const forecastByKey = new Map(
    byCategory.map((item) => [item.key, { label: item.label, amount: item.forecast }]),
  )
  const planVsForecast = planVsForecastRows(budget, month, seriesId, categories, forecastByKey, config)
  let actualStack: TimelineStack[] = []
  let forecastStack: TimelineStack[] = []
  if (seriesId === 'household') {
    forecastStack = forecastStackFromCategories(byCategory, bucketMix, config.reimbursableAllowList)
    if (kind !== 'future') {
      actualStack = orderedStack(
        actualBucketParts(householdTx, currency, month, config.reimbursableAllowList, parentTag),
        config.reimbursableAllowList,
      )
    }
  }
  return {
    month,
    kind,
    actual: roundCents(actual),
    calendar: forecast,
    overlay,
    plan: roundCents(plan),
    knownFutures: roundCents(onForecast),
    outsideControlWindow: seriesId === 'household' && isOutsideControlWindow(forecast, plan),
    gapRatio: seriesId === 'household' ? controlGap(forecast, plan) : 0,
    byCategory,
    variances: seriesId === 'household' ? gapRows(planVsForecast, forecast, plan) : [],
    planVsForecast,
    actualStack,
    forecastStack,
    stack: kind === 'future' ? forecastStack : actualStack,
  }
}

function monthDiff(from: string, to: string): number {
  return (
    Number(to.slice(0, 4)) * 12 +
    Number(to.slice(5, 7)) -
    (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)))
  )
}

function currentMonthView(args: {
  asOf: string
  categories: CategoryForecast[]
  series: CategorySeries[]
  lookback: string[]
  actuals: CategoryActuals[]
  budget: Budget
  config: ForecastConfig
  overlay: number
}): CurrentMonthView {
  const { asOf, categories, series, lookback, actuals, budget, config, overlay } = args
  const month = asOf.slice(0, 7)
  const mm = Number(month.slice(5, 7))
  const byKey = new Map(series.map((item) => [item.key, item]))
  const actualToDate = totalInMonth(actuals, month)
  const postedTypicalKeys: string[] = []
  const remainByKey = new Map<string, RemainLine>()
  let remainHigh = 0

  const consider = (line: RemainLine) => {
    const remainAmt = roundCents(Math.max(0, line.remain))
    if (remainAmt <= 0) return
    const next: RemainLine = {
      ...line,
      typical: roundCents(line.typical),
      actual: roundCents(line.actual),
      remain: remainAmt,
    }
    const prev = remainByKey.get(line.key)
    if (!prev || next.remain > prev.remain) remainByKey.set(line.key, next)
  }

  for (const category of categories) {
    const actual = spendInMonth(actuals, category.key, month)
    const planAmt = planForCategory(budget, category.key)
    if (usesPlanPrior(category, planAmt)) {
      consider({
        key: category.key,
        label: category.label,
        typical: planAmt,
        actual,
        remain: Math.max(0, planAmt - actual),
        reason: 'monthly',
      })
      remainHigh += Math.max(0, planAmt - actual)
      continue
    }
    if (isMonthlyType(category.type)) {
      consider({
        key: category.key,
        label: category.label,
        typical: category.likely,
        actual,
        remain: Math.max(0, category.likely - actual),
        reason: 'monthly',
      })
      remainHigh += Math.max(0, category.high - actual)
      continue
    }
    if (
      (category.type === 'predictable-annual' || category.type === 'seasonal') &&
      category.typicalMonths.includes(mm)
    ) {
      const expected = placedAmount(
        category,
        byKey.get(category.key),
        lookback,
        month,
        planForCategory(budget, category.key),
      ).amount
      const typical =
        category.type === 'seasonal'
          ? seasonalCurrentTarget(expected, category.meanPresent, category.lowSample)
          : expected
      if (actual > 0) {
        if (category.type === 'seasonal' && !category.lowSample) {
          const leftover = Math.max(0, typical - actual)
          consider({
            key: category.key,
            label: category.label,
            typical,
            actual,
            remain: leftover,
            reason: 'in-progress-irregular',
          })
          remainHigh += leftover
          if (leftover <= 0) postedTypicalKeys.push(category.key)
          continue
        }
        postedTypicalKeys.push(category.key)
        continue
      }
      consider({
        key: category.key,
        label: category.label,
        typical,
        actual,
        remain: typical,
        reason: 'expected-lump',
      })
      remainHigh += Math.max(typical, category.high)
      continue
    }
    if (category.type === 'irregular' && actual > 0 && !category.lowSample) {
      const leftover = Math.max(0, category.meanPresent - actual)
      consider({
        key: category.key,
        label: category.label,
        typical: category.meanPresent,
        actual,
        remain: leftover,
        reason: 'in-progress-irregular',
      })
      remainHigh += leftover
    }
  }

  const posted = new Set(postedTypicalKeys)
  for (const future of futuresFor(config, month, 'household')) {
    if (!pinAddsToForecast(future)) continue
    const key = nameKey(future.category)
    if (posted.has(key)) continue
    const actual = spendInMonth(actuals, key, month)
    const leftover = Math.max(0, future.amount - actual)
    const label = categories.find((c) => c.key === key)?.label ?? future.category
    consider({
      key,
      label,
      typical: future.amount,
      actual,
      remain: leftover,
      reason: 'known-future',
    })
    remainHigh += leftover
  }

  const remainLines = [...remainByKey.values()].sort(
    (a, z) => z.remain - a.remain || a.label.localeCompare(z.label),
  )
  const remain = remainLines.reduce((sum, line) => sum + line.remain, 0)

  const forecastEom = actualToDate + remain
  const plan = totalExpenses(budget) + futureTotal(config, month, 'household')
  const forecastByKey = new Map<string, { label: string; amount: number }>()
  for (const category of categories) {
    const actual = spendInMonth(actuals, category.key, month)
    const leftover = remainByKey.get(category.key)?.remain ?? 0
    forecastByKey.set(category.key, { label: category.label, amount: roundCents(actual + leftover) })
  }
  for (const line of remainLines) {
    if (!forecastByKey.has(line.key)) {
      forecastByKey.set(line.key, { label: line.label, amount: roundCents(line.actual + line.remain) })
    }
  }
  for (const row of actuals) {
    const actual = row.byMonth.get(month) ?? 0
    if (actual === 0 || forecastByKey.has(row.key)) continue
    forecastByKey.set(row.key, { label: row.label, amount: roundCents(actual) })
  }
  const planVsForecast = planVsForecastRows(budget, month, 'household', categories, forecastByKey, config)

  return {
    month,
    actualToDate: roundCents(actualToDate),
    remain: roundCents(remain),
    remainHigh: roundCents(remainHigh),
    forecastEom: roundCents(forecastEom),
    plan: roundCents(plan),
    overlay,
    outsideControlWindow: isOutsideControlWindow(forecastEom, plan),
    gapRatio: controlGap(forecastEom, plan),
    variances: gapRows(planVsForecast, forecastEom, plan),
    postedTypicalKeys,
    remainLines,
    planVsForecast,
  }
}

function coverageFor(
  budget: Budget,
  lookback: string[],
  householdActuals: CategoryActuals[],
  vacationGoal: VacationGoalMatch,
  target: number,
): CoverageResult {
  const income = totalIncome(budget)
  const vacationMonthly = vacationGoal.status === 'matched' ? vacationGoal.monthly : 0
  const householdCommitted = totalGoalContributions(budget) - vacationMonthly
  const surpluses = lookback.map((month) => income - totalInMonth(householdActuals, month))
  const monthsHit = surpluses.filter((surplus) => surplus >= householdCommitted).length
  const n = lookback.length
  const coverage = n > 0 ? monthsHit / n : 0
  const sorted = [...surpluses].sort((a, z) => a - z)
  const minHits = n === 0 ? 0 : Math.ceil(target * n)
  const allowedMisses = Math.max(0, n - minHits)
  const contributionThatWouldClear = n === 0 ? 0 : Math.max(0, sorted[Math.min(allowedMisses, n - 1)] ?? 0)
  const monthlySpend = lookback.map((month) => totalInMonth(householdActuals, month))
  return {
    householdCommitted: roundCents(householdCommitted),
    vacationMonthly: roundCents(vacationMonthly),
    income: roundCents(income),
    coverage,
    coverageTarget: target,
    funded: coverage >= target,
    monthsHit,
    monthsConsidered: n,
    contributionThatWouldClear: roundCents(contributionThatWouldClear),
    highSetAside: roundCents(percentile(monthlySpend, 0.9)),
  }
}

function vacationForecastFor(args: {
  categories: CategoryForecast[]
  series: CategorySeries[]
  lookback: string[]
  actuals: CategoryActuals[]
  config: ForecastConfig
  asOf: string
  goal: VacationGoalMatch
  sweep: number
}): VacationForecast {
  const { categories, series, lookback, actuals, config, asOf, goal, sweep } = args
  const { past, rest } = timelineMonths(asOf)
  const months: VacationMonth[] = []
  for (const month of past) {
    months.push(vacationMonthPoint('past', month, categories, series, lookback, actuals, config, asOf, sweep))
  }
  for (const month of rest) {
    const kind = month === asOf.slice(0, 7) ? 'current' : 'future'
    months.push(vacationMonthPoint(kind, month, categories, series, lookback, actuals, config, asOf, sweep))
  }

  let bal = goal.current
  let firstShortfallMonth: string | undefined
  for (const point of months) {
    if (point.kind === 'past') {
      point.runway = 0
      continue
    }
    bal = roundCents(bal + point.contribution)
    const draw = point.kind === 'current' ? Math.max(point.actual, point.forecast) : point.forecast
    bal = roundCents(bal - draw)
    point.runway = bal
    if (bal < 0 && !firstShortfallMonth) firstShortfallMonth = point.month
  }

  return {
    categories,
    months,
    pot: roundCents(goal.current),
    monthlyContribution: roundCents(sweep),
    currentMonthPaused: false,
    runwayGoesNegative: Boolean(firstShortfallMonth),
    firstShortfallMonth,
  }
}

function vacationMonthPoint(
  kind: VacationMonth['kind'],
  month: string,
  categories: CategoryForecast[],
  series: CategorySeries[],
  lookback: string[],
  actuals: CategoryActuals[],
  config: ForecastConfig,
  asOf: string,
  sweep: number,
): VacationMonth {
  const point = calendarPoint({
    month,
    kind,
    categories,
    series,
    lookback,
    actuals,
    budget: emptyBudget(),
    config,
    asOf,
    overlay: 0,
    seriesId: 'vacation',
    householdTx: [],
    currency: 'CAD',
    parentTag: DEFAULT_REIMBURSABLE_PARENT,
    bucketMix: new Map(),
  })
  const actual = kind === 'future' ? 0 : point.actual
  const forecast = point.calendar
  const isTravel =
    (kind === 'past' && actual > TRAVEL_THRESHOLD) ||
    (kind !== 'past' && (actual > TRAVEL_THRESHOLD || forecast > TRAVEL_THRESHOLD))
  return {
    month,
    kind,
    actual: roundCents(actual),
    forecast: roundCents(forecast),
    isTravel,
    contribution: roundCents(sweep),
    runway: 0,
  }
}

function emptyBudget(): Budget {
  return {
    version: 1,
    profile: { name: '', housing: 'other', household: 'single', dependents: 0, hasDebt: false, region: '' },
    income: [],
    expenses: [],
    goals: [],
    updatedAt: '',
    source: 'sample',
  }
}

function doubleCountsFor(
  categories: CategoryForecast[],
  config: ForecastConfig,
  asOf: string,
): DoubleCountWarning[] {
  const warnings: DoubleCountWarning[] = []
  const current = asOf.slice(0, 7)
  for (let i = 0; i < 12; i++) {
    const month = addMonths(current, i)
    const mm = Number(month.slice(5, 7))
    for (const future of futuresFor(config, month, 'household')) {
      if (!pinAddsToForecast(future)) continue
      const category = categories.find((item) => item.key === nameKey(future.category))
      if (!category) continue
      if (
        (category.type === 'predictable-annual' || category.type === 'seasonal') &&
        category.typicalMonths.includes(mm)
      ) {
        warnings.push({ category: category.label, month })
      }
    }
  }
  return warnings
}

function buildCurrency(args: {
  currency: Currency
  householdTx: Transaction[]
  vacationTx: Transaction[]
  lookback: string[]
  budget: Budget
  config: ForecastConfig
  asOf: string
  label: string
  vacationGoal: VacationGoalMatch
  parentTag: string
}): CurrencyForecast {
  const { currency, householdTx, vacationTx, lookback, budget, config, asOf, label, vacationGoal, parentTag } =
    args
  const bucketMix = categoryBucketMix(
    householdTx,
    currency,
    lookback,
    config.reimbursableAllowList,
    parentTag,
  )
  const extras = [
    ...budget.expenses.map((line) => ({ key: nameKey(line.name), label: line.name })),
    ...config.knownFutures
      .filter((future) => (future.series ?? 'household') === 'household')
      .map((future) => ({ key: nameKey(future.category), label: future.category })),
  ]
  const householdActuals = ensureNamedSeries(accumulate(householdTx, currency), currency === 'CAD' ? extras : [])
  const vacationActuals = ensureNamedSeries(
    accumulate(vacationTx, currency),
    config.knownFutures
      .filter((future) => future.series === 'vacation')
      .map((future) => ({ key: nameKey(future.category), label: future.category })),
  )
  const householdSeries = toSeries(
    householdActuals,
    lookback,
    currency === 'CAD' ? new Set(budget.expenses.map((line) => nameKey(line.name))) : new Set(),
  )
  const vacationSeries = toSeries(vacationActuals, lookback)
  const householdCategories = classifyCategories(householdSeries, lookback, config.categoryOverrides)
  if (currency === 'CAD') applyPlanPriors(householdCategories, budget)
  const vacationCategories = classifyCategories(vacationSeries, lookback, config.categoryOverrides)

  const overlay = overlayFor(
    householdCategories,
    householdSeries,
    lookback,
    config,
    asOf,
    config.excludeTopOutliers,
  )
  const lowOverlay = overlayFor(
    householdCategories,
    householdSeries,
    lookback,
    config,
    asOf,
    Math.max(config.excludeTopOutliers, 1),
  )
  const monthlySpend = lookback.map((month) => totalInMonth(householdActuals, month))
  const setAside = setAsideFor(householdCategories, monthlySpend, overlay, lowOverlay, config, label)

  const { past, rest } = timelineMonths(asOf)
  const calendar: MonthPoint[] = []
  for (const month of past) {
    calendar.push(
      calendarPoint({
        month,
        kind: 'past',
        categories: householdCategories,
        series: householdSeries,
        lookback,
        actuals: householdActuals,
        budget,
        config,
        asOf,
        overlay: overlay.monthly,
        seriesId: 'household',
        householdTx,
        currency,
        parentTag,
        bucketMix,
      }),
    )
  }
  for (const month of rest) {
    const kind = month === asOf.slice(0, 7) ? 'current' : 'future'
    const point = calendarPoint({
      month,
      kind,
      categories: householdCategories,
      series: householdSeries,
      lookback,
      actuals: householdActuals,
      budget,
      config,
      asOf,
      overlay: overlay.monthly,
      seriesId: 'household',
      householdTx,
      currency,
      parentTag,
      bucketMix,
    })
    if (kind === 'current') {
      const current = currentMonthView({
        asOf,
        categories: householdCategories,
        series: householdSeries,
        lookback,
        actuals: householdActuals,
        budget,
        config,
        overlay: overlay.monthly,
      })
      point.actual = current.actualToDate
      point.calendar = current.forecastEom
      point.plan = current.plan
      point.outsideControlWindow = current.outsideControlWindow
      point.gapRatio = current.gapRatio
      point.variances = current.variances
      point.planVsForecast = current.planVsForecast
      point.actualStack = orderedStack(
        actualBucketParts(householdTx, currency, month, config.reimbursableAllowList, parentTag),
        config.reimbursableAllowList,
      )
      point.forecastStack = currentReadingStack(
        householdTx,
        currency,
        month,
        current.remainLines,
        bucketMix,
        config.reimbursableAllowList,
        parentTag,
      )
      point.stack = point.forecastStack
    }
    calendar.push(point)
  }

  const household: HouseholdForecast = {
    categories: householdCategories,
    calendar,
    overlay,
    setAside,
    currentMonth: currentMonthView({
      asOf,
      categories: householdCategories,
      series: householdSeries,
      lookback,
      actuals: householdActuals,
      budget,
      config,
      overlay: overlay.monthly,
    }),
  }

  const vacation = vacationForecastFor({
    categories: vacationCategories,
    series: vacationSeries,
    lookback,
    actuals: vacationActuals,
    config,
    asOf,
    goal: vacationGoal,
    sweep:
      currency === 'CAD'
        ? vacationSweep({
            income: totalIncome(budget),
            likelySetAside: setAside.likely,
            householdCommitted: totalGoalContributions(budget) - (vacationGoal.status === 'matched' ? vacationGoal.monthly : 0),
          })
        : 0,
  })

  return { currency, household, vacation }
}

/**
 * Pure forecast: (transactions, budget, config, asOf) → ForecastResult.
 * Dates stay ISO strings. CAD and USD are never added together.
 */
export function forecast(
  transactions: Transaction[],
  budget: Budget,
  config: ForecastConfig,
  asOf: string,
  reimbursableParentTag: string = DEFAULT_REIMBURSABLE_PARENT,
): ForecastResult {
  const resolved = withForecastDefaults(config)
  const split = splitUniverse(transactions, resolved, reimbursableParentTag)
  const lookback = lookbackMonths(asOf, resolved.window, earliestMonth(transactions))
  const requestedMonths = resolved.window
  const label = windowLabel(resolved.window, lookback.length)
  const vacationGoal = matchVacationGoal(budget, resolved)

  const cad = buildCurrency({
    currency: 'CAD',
    householdTx: split.household,
    vacationTx: split.vacation,
    lookback,
    budget,
    config: resolved,
    asOf,
    label,
    vacationGoal,
    parentTag: reimbursableParentTag,
  })
  const usd = buildCurrency({
    currency: 'USD',
    householdTx: split.household,
    vacationTx: split.vacation,
    lookback,
    budget,
    config: resolved,
    asOf,
    label,
    vacationGoal,
    parentTag: reimbursableParentTag,
  })

  return {
    asOf,
    window: resolved.window,
    lookback,
    requestedMonths,
    availableMonths: lookback.length,
    windowLabel: label,
    reimbursableParentTag,
    seriesCounts: {
      household: split.household.length,
      vacation: split.vacation.length,
      excluded: split.excluded.length,
      dropped: split.dropped.length,
    },
    cad,
    usd,
    coverage: coverageFor(
      budget,
      lookback,
      accumulate(split.household, 'CAD'),
      vacationGoal,
      resolved.coverageTarget,
    ),
    vacationGoal,
    doubleCounts: doubleCountsFor(cad.household.categories, resolved, asOf),
  }
}
