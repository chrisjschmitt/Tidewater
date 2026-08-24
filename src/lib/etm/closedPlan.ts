import { totalExpenses } from '../budget'
import type { Budget } from '../types'
import type { ReconciliationRecord } from './types'

/** Typical-month spend kept when a month is closed — expenses, not goals. */
export function planSpendAtClose(budget: Budget): number {
  return Math.round(totalExpenses(budget) * 100) / 100
}

/**
 * First close of a month captures today's typical-month spend. Later saves
 * keep that figure, even if the dashboard sliders move.
 */
export function withPlanAtClose(record: ReconciliationRecord, budget: Budget): ReconciliationRecord {
  if (record.status !== 'reconciled') return record
  if (typeof record.plannedSpend === 'number') return record
  return { ...record, plannedSpend: planSpendAtClose(budget) }
}

export interface ClosedPlanPoint {
  month: string
  planned: number
  actual: number
}

/** Closed months that have a kept plan, oldest first. */
export function closedPlanTrend(
  records: ReconciliationRecord[],
  actualInMonth: (month: string) => number,
): ClosedPlanPoint[] {
  return records
    .filter((record) => record.status === 'reconciled' && typeof record.plannedSpend === 'number')
    .sort((a, z) => a.month.localeCompare(z.month))
    .map((record) => ({
      month: record.month,
      planned: record.plannedSpend ?? 0,
      actual: Math.round(actualInMonth(record.month) * 100) / 100,
    }))
}
