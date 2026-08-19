import type { CategoryForecast, CategoryOverride, Confidence, ExpenseType } from './types'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** A recent step-up is taken as the new level when variation is this small. */
const LAST_AMOUNT_CV = 0.05
const PRESENCE_MONTHLY = 0.75
const PRESENCE_SEASONAL = 0.6
const CV_SMOOTH = 0.2
const DRIFT_RATIO = 0.15

export const roundCents = (n: number): number => Math.round(n * 100) / 100

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((sum, n) => sum + n, 0) / xs.length
}

/** Linear interpolation, same idea as a spreadsheet percentile. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, z) => a - z)
  if (sorted.length === 1) return sorted[0]!
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

export const median = (xs: number[]): number => percentile(xs, 0.5)

export function cvOf(xs: number[]): number {
  if (xs.length < 2) return 0
  const avg = mean(xs)
  if (avg === 0) return 0
  const variance = xs.reduce((sum, n) => sum + (n - avg) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance) / Math.abs(avg)
}

export const monthWord = (mm: number): string => MONTH_NAMES[mm - 1] ?? String(mm)

export const monthWords = (months: number[]): string[] => months.map(monthWord)

const uniqueMonths = (present: string[]): number[] =>
  [...new Set(present.map((m) => Number(m.slice(5, 7))))].sort((a, z) => a - z)

const repeatedCycle = (present: string[]): boolean => {
  const yearsByMm = new Map<number, Set<number>>()
  for (const month of present) {
    const year = Number(month.slice(0, 4))
    const mm = Number(month.slice(5, 7))
    const years = yearsByMm.get(mm) ?? new Set<number>()
    years.add(year)
    yearsByMm.set(mm, years)
  }
  return [...yearsByMm.values()].some((years) => years.size > 1)
}

/**
 * Two calendar months count as a single annual bill when they sit next to
 * each other (including December/January). June and December are a season,
 * not a tight cluster — otherwise the §6 table would swallow every
 * two-month seasonal category as Predictable Annual.
 */
export function isTightMonthCluster(months: number[]): boolean {
  const unique = [...new Set(months)].sort((a, z) => a - z)
  if (unique.length <= 1) return true
  if (unique.length !== 2) return false
  const [a, b] = unique
  const dist = Math.min(b! - a!, a! + 12 - b!)
  return dist <= 1
}

const isAnnualShape = (calendarMonths: number[]): boolean =>
  calendarMonths.length === 1 || (calendarMonths.length === 2 && isTightMonthCluster(calendarMonths))

export interface CategorySeries {
  key: string
  label: string
  /** One value per lookback month, 0 when the category was absent. */
  values: number[]
}

function pickType(input: {
  occurrences: number
  presence: number
  cv: number
  calendarMonths: number[]
  cycle: boolean
}): ExpenseType {
  const { occurrences, presence, cv, calendarMonths, cycle } = input
  // One or two hits are not a cycle — except a fee that has already landed
  // in the same calendar month in two different years, which *is* annual.
  if (occurrences < 3) {
    if (occurrences >= 2 && calendarMonths.length === 1 && cycle) return 'predictable-annual'
    return 'irregular'
  }
  if (presence >= PRESENCE_MONTHLY && cv <= CV_SMOOTH) return 'predictable-monthly'
  if (presence >= PRESENCE_MONTHLY && cv > CV_SMOOTH) return 'variable-monthly'
  if (occurrences >= 2 && isAnnualShape(calendarMonths)) return 'predictable-annual'
  if (occurrences >= 2 && presence <= PRESENCE_SEASONAL && calendarMonths.length <= 6) return 'seasonal'
  return 'irregular'
}

function confidenceFor(type: ExpenseType, occurrences: number, cv: number, cycle: boolean): Confidence {
  if (occurrences < 3) return 'low'
  if (type === 'predictable-monthly' && cv <= CV_SMOOTH) return 'high'
  if (type === 'predictable-annual' && cycle) return 'high'
  return 'medium'
}

function presentMonthsOf(values: number[], months: string[]): string[] {
  return months.filter((_, i) => values[i]! > 0)
}

function lastPresentAmount(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i]! > 0) return values[i]!
  }
  return 0
}

function classifySlice(values: number[], months: string[]): ExpenseType {
  const present = presentMonthsOf(values, months)
  const presentAmounts = values.filter((n) => n > 0)
  return pickType({
    occurrences: present.length,
    presence: months.length === 0 ? 0 : present.length / months.length,
    cv: cvOf(presentAmounts),
    calendarMonths: uniqueMonths(present),
    cycle: repeatedCycle(present),
  })
}

function driftNote(values: number[], months: string[]): string | undefined {
  if (months.length < 12) return undefined
  const last6 = classifySlice(values.slice(-6), months.slice(-6))
  const last12 = classifySlice(values.slice(-12), months.slice(-12))
  const notes: string[] = []
  if (last6 !== last12) {
    notes.push(`lately ${last6.replace(/-/g, ' ')} rather than ${last12.replace(/-/g, ' ')}`)
  }
  if (months.length >= 24) {
    const avg12 = mean(values.slice(-12))
    const avg24 = mean(values)
    if (avg24 > 0 && avg12 > avg24 * (1 + DRIFT_RATIO)) notes.push('running higher lately')
  }
  return notes.length > 0 ? notes.join('; ') : undefined
}

export function classifyCategory(
  series: CategorySeries,
  months: string[],
  override?: CategoryOverride,
): CategoryForecast {
  const present = presentMonthsOf(series.values, months)
  const presentAmounts = series.values.filter((n) => n > 0)
  const occurrences = present.length
  const n = months.length
  const presence = n === 0 ? 0 : occurrences / n
  const cv = cvOf(presentAmounts)
  const calendarMonths = uniqueMonths(present)
  const cycle = repeatedCycle(present)
  const autoType = pickType({ occurrences, presence, cv, calendarMonths, cycle })
  const type = override?.type ?? autoType
  const typicalMonths = (override?.typicalMonths?.filter((m) => m >= 1 && m <= 12) ?? calendarMonths)
    .slice()
    .sort((a, z) => a - z)
  const meanPresent = mean(presentAmounts)
  const lastAmount = lastPresentAmount(series.values)
  const windowTotal = series.values.reduce((sum, v) => sum + v, 0)

  let likely = 0
  let high = 0
  let low = 0
  let setAsideShare = 0
  let usedLastAmount = false

  if (type === 'predictable-monthly') {
    const lastSixPresent = presentAmounts.slice(-6)
    const sample = lastSixPresent.length > 0 ? lastSixPresent : presentAmounts
    likely = median(sample)
    if (cv <= LAST_AMOUNT_CV && lastAmount > 0) {
      likely = lastAmount
      usedLastAmount = true
    }
    high = percentile(series.values, 0.75)
    low = percentile(series.values, 0.25)
    setAsideShare = likely
  } else if (type === 'variable-monthly') {
    likely = median(series.values)
    high = percentile(series.values, 0.75)
    low = percentile(series.values, 0.25)
    setAsideShare = likely
  } else if (type === 'predictable-annual') {
    likely = override?.amount ?? meanPresent
    high = likely
    low = likely
    const hits = Math.max(1, typicalMonths.length)
    setAsideShare = likely / (12 / hits)
  } else if (type === 'seasonal') {
    likely = meanPresent
    high = percentile(presentAmounts, 0.75)
    low = percentile(presentAmounts, 0.25)
    setAsideShare = n > 0 ? windowTotal / n : 0
  } else {
    likely = 0
    high = 0
    low = 0
    setAsideShare = n > 0 ? windowTotal / n : 0
  }

  if (override?.amount != null && type !== 'irregular') {
    likely = override.amount
    if (type === 'predictable-monthly' || type === 'variable-monthly') {
      high = Math.max(high, likely)
      low = Math.min(low === 0 ? likely : low, likely)
      setAsideShare = likely
    }
  }

  return {
    key: series.key,
    label: series.label,
    type,
    confidence: confidenceFor(type, occurrences, cv, cycle),
    overridden: Boolean(override?.type || override?.amount != null || override?.typicalMonths),
    occurrences,
    monthsPresent: occurrences,
    meanPresent: roundCents(meanPresent),
    cv: Math.round(cv * 1000) / 1000,
    typicalMonths,
    typicalMonthNames: monthWords(typicalMonths),
    likely: roundCents(likely),
    high: roundCents(high),
    low: roundCents(low),
    windowTotal: roundCents(windowTotal),
    setAsideShare: roundCents(setAsideShare),
    lastAmount: roundCents(lastAmount),
    usedLastAmount,
    lowSample: occurrences < 3,
    repeatedCycle: cycle,
    average12: n === 0 ? 0 : roundCents(mean(series.values.slice(-Math.min(12, n)))),
    average24: n >= 24 ? roundCents(mean(series.values.slice(-24))) : undefined,
    drift: driftNote(series.values, months),
  }
}

export function classifyCategories(
  series: CategorySeries[],
  months: string[],
  overrides: Record<string, CategoryOverride> = {},
): CategoryForecast[] {
  return series
    .map((item) => classifyCategory(item, months, overrides[item.key]))
    .sort((a, z) => z.windowTotal - a.windowTotal || a.label.localeCompare(z.label))
}
