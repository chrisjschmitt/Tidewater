/**
 * The single period every ETM view is read through.
 *
 * Dates are handled as ISO strings throughout. Parsing them into `Date`
 * objects invites a timezone to shift a transaction into the neighbouring
 * month, which would quietly move money between periods.
 */

export type PeriodKind = 'month' | 'ytd' | 'range'

export interface Period {
  kind: PeriodKind
  /** Inclusive, YYYY-MM-DD. */
  start: string
  /** Inclusive, YYYY-MM-DD. */
  end: string
}

export const monthPeriod = (month: string): Period => ({
  kind: 'month',
  start: `${month}-01`,
  end: `${month}-${String(daysInMonth(month)).padStart(2, '0')}`,
})

export const ytdPeriod = (through: string): Period => ({
  kind: 'ytd',
  start: `${through.slice(0, 4)}-01-01`,
  end: through,
})

export const rangePeriod = (start: string, end: string): Period => ({
  kind: 'range',
  start: start <= end ? start : end,
  end: start <= end ? end : start,
})

export const includes = (period: Period, date: string): boolean =>
  date >= period.start && date <= period.end

/**
 * How many months of a monthly plan the period should be compared against.
 * Calendar months touched, so a year-to-date period part-way through August
 * compares against eight months of plan — the figure someone can recognise
 * from their own budget, rather than a fraction of a month nobody recognises.
 */
export function monthsInPeriod(period: Period): number {
  const [sy, sm] = split(period.start)
  const [ey, em] = split(period.end)
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1)
}

/** Every month chunk the period touches, oldest first. */
export function monthKeys(period: Period): string[] {
  const keys: string[] = []
  let [year, month] = split(period.start)
  const [endYear, endMonth] = split(period.end)
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`)
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return keys
}

export function periodLabel(period: Period): string {
  if (period.kind === 'month') return monthName(period.start.slice(0, 7))
  if (period.kind === 'ytd') return `${period.start.slice(0, 4)} so far`
  return `${period.start} to ${period.end}`
}

export function monthName(month: string): string {
  const [year, m] = split(`${month}-01`)
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export const today = (): string => new Date().toISOString().slice(0, 10)

function daysInMonth(month: string): number {
  const [year, m] = split(`${month}-01`)
  return new Date(Date.UTC(year, m, 0)).getUTCDate()
}

function split(date: string): [number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7))]
}
