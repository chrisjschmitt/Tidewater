import { roundCents } from './classify'
import { addMonths, controlGap, isOutsideControlWindow } from './forecast'
import type { ForecastResult, ForecastSnapshot, MonthCategoryAmount } from './types'
import type { Goal } from '../types'

export type SnapshotSource = 'stored' | 'reconstructed'

export interface CategoryMiss {
  key: string
  label: string
  forecast: number
  actual: number
  delta: number
}

export interface MonthEndVariance {
  month: string
  source: SnapshotSource
  actual: number
  forecast: number
  outsideControlWindow: boolean
  gapRatio: number
  higher: CategoryMiss[]
  lower: CategoryMiss[]
}

export interface ReconstructedMonth {
  forecast: number
  byCategory: Array<{ key: string; label: string; forecast: number }>
}

export function snapshotId(month: string): string {
  return `forecast-snap-${month}`
}

export function lastFullMonth(asOf: string): string {
  return addMonths(asOf.slice(0, 7), -1)
}

export function snapshotFromResult(result: ForecastResult, month: string): ForecastSnapshot {
  const household = result.cad.household
  const point = household.calendar.find((row) => row.month === month)
  const vacation = result.cad.vacation.months.find((row) => row.month === month)
  const isCurrent = household.currentMonth.month === month
  const actual =
    isCurrent ? household.currentMonth.actualToDate : point && point.kind !== 'future' ? point.actual : undefined
  return {
    month,
    asOf: result.asOf,
    window: result.window,
    calendar: point?.calendar ?? 0,
    overlay: point?.overlay ?? household.setAside.overlay,
    setAsideLikely: household.setAside.likely,
    setAsideHigh: household.setAside.high,
    plan: point?.plan ?? 0,
    actual,
    vacationForecast: vacation?.forecast,
    vacationActual: vacation && vacation.kind !== 'future' ? vacation.actual : undefined,
    byCategory: (point?.byCategory ?? []).map((row) => ({
      key: row.key,
      forecast: row.forecast,
      actual: row.actual,
    })),
  }
}

/**
 * First visit in a month keeps the forecast. Later visits only refresh actuals
 * so month-end variance can still compare against the number that was stored.
 */
export function refreshSnapshotActuals(existing: ForecastSnapshot, next: ForecastSnapshot): ForecastSnapshot {
  const actualByKey = new Map(next.byCategory.map((row) => [row.key, row.actual]))
  return {
    ...existing,
    asOf: next.asOf,
    actual: next.actual,
    vacationActual: next.vacationActual,
    byCategory: existing.byCategory.map((row) => ({
      ...row,
      actual: actualByKey.has(row.key) ? actualByKey.get(row.key) : row.actual,
    })),
  }
}

export function snapshotsEqual(a: ForecastSnapshot, b: ForecastSnapshot): boolean {
  return (
    a.month === b.month &&
    a.asOf === b.asOf &&
    a.window === b.window &&
    a.calendar === b.calendar &&
    a.overlay === b.overlay &&
    a.setAsideLikely === b.setAsideLikely &&
    a.setAsideHigh === b.setAsideHigh &&
    a.plan === b.plan &&
    a.actual === b.actual &&
    a.vacationForecast === b.vacationForecast &&
    a.vacationActual === b.vacationActual &&
    a.byCategory.length === b.byCategory.length &&
    a.byCategory.every(
      (row, i) =>
        row.key === b.byCategory[i]?.key &&
        row.forecast === b.byCategory[i]?.forecast &&
        row.actual === b.byCategory[i]?.actual,
    )
  )
}

export function monthEndVariance(args: {
  month: string
  actual: number
  actualByCategory: Array<Pick<MonthCategoryAmount, 'key' | 'label' | 'actual'>>
  snapshot?: ForecastSnapshot | null
  reconstructed?: ReconstructedMonth | null
}): MonthEndVariance | null {
  const { month, actual, actualByCategory } = args
  const snapshot = args.snapshot
  const reconstructed = args.reconstructed
  if (snapshot) {
    return varianceFrom(
      month,
      'stored',
      actual,
      snapshot.calendar,
      snapshot.byCategory.map((row) => ({
        key: row.key,
        label: labelFor(row.key, actualByCategory),
        forecast: row.forecast,
      })),
      actualByCategory,
    )
  }
  if (reconstructed) {
    return varianceFrom(month, 'reconstructed', actual, reconstructed.forecast, reconstructed.byCategory, actualByCategory)
  }
  return null
}

function varianceFrom(
  month: string,
  source: SnapshotSource,
  actual: number,
  forecast: number,
  rows: Array<{ key: string; label: string; forecast: number }>,
  actualByCategory: Array<Pick<MonthCategoryAmount, 'key' | 'label' | 'actual'>>,
): MonthEndVariance {
  const actualByKey = new Map(actualByCategory.map((row) => [row.key, row]))
  const seen = new Set<string>()
  const misses: CategoryMiss[] = []
  for (const row of rows) {
    seen.add(row.key)
    const actualRow = actualByKey.get(row.key)
    const spent = actualRow?.actual ?? 0
    const delta = roundCents(spent - row.forecast)
    if (delta === 0) continue
    misses.push({
      key: row.key,
      label: actualRow?.label ?? row.label,
      forecast: row.forecast,
      actual: spent,
      delta,
    })
  }
  for (const row of actualByCategory) {
    if (seen.has(row.key) || row.actual === 0) continue
    misses.push({
      key: row.key,
      label: row.label,
      forecast: 0,
      actual: row.actual,
      delta: roundCents(row.actual),
    })
  }
  misses.sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta))
  return {
    month,
    source,
    actual,
    forecast,
    outsideControlWindow: isOutsideControlWindow(actual, forecast),
    gapRatio: controlGap(actual, forecast),
    higher: misses.filter((row) => row.delta > 0),
    lower: misses.filter((row) => row.delta < 0),
  }
}

function labelFor(key: string, rows: Array<Pick<MonthCategoryAmount, 'key' | 'label'>>): string {
  return rows.find((row) => row.key === key)?.label ?? key
}

/** Spread a household monthly contribution across non-vacation goals. Vacation is untouched. */
export function withHouseholdContribution(
  goals: Goal[],
  monthly: number,
  vacationGoalId?: string,
): Goal[] {
  const amount = roundCents(Math.max(0, monthly))
  const household = goals.filter((goal) => goal.id !== vacationGoalId)
  if (household.length === 0) return goals
  const currentSum = household.reduce((sum, goal) => sum + (goal.monthly || 0), 0)
  const weights = household.map((goal) => (currentSum > 0 ? (goal.monthly || 0) / currentSum : 1 / household.length))
  const next = new Map<string, number>()
  let allocated = 0
  for (let i = 0; i < household.length; i++) {
    const goal = household[i]!
    if (i === household.length - 1) {
      next.set(goal.id, roundCents(amount - allocated))
    } else {
      const share = roundCents(amount * weights[i]!)
      next.set(goal.id, share)
      allocated += share
    }
  }
  return goals.map((goal) => (next.has(goal.id) ? { ...goal, monthly: next.get(goal.id)! } : goal))
}

export function householdGoalCount(goals: Goal[], vacationGoalId?: string): number {
  return goals.filter((goal) => goal.id !== vacationGoalId).length
}
