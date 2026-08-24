import { monthPeriod } from '../etm/period'
import type { Budget } from '../types'
import type { Transaction } from '../etm/types'
import { addMonths, forecast, timelineMonths } from './forecast'
import type { ExpenseType, ForecastConfig } from './types'
import { DEFAULT_REIMBURSABLE_PARENT, nameKey, signedSpend, splitUniverse } from './universe'

const TYPES: ExpenseType[] = [
  'predictable-monthly',
  'variable-monthly',
  'predictable-annual',
  'seasonal',
  'irregular',
]

export interface TypeTotals {
  actual: number
  forecast: number
  count: number
}

export interface WalkForwardCategory {
  key: string
  label: string
  forecast: number
  actual: number
}

export interface WalkForwardMonth {
  month: string
  actual: number
  forecast: number
  error: number
  byType: Record<ExpenseType, TypeTotals>
  byCategory: WalkForwardCategory[]
}

export interface WalkForwardResult {
  months: WalkForwardMonth[]
  byType: Record<ExpenseType, { mae: number; months: number }>
}

const emptyTypes = (): Record<ExpenseType, TypeTotals> =>
  Object.fromEntries(TYPES.map((type) => [type, { actual: 0, forecast: 0, count: 0 }])) as Record<
    ExpenseType,
    TypeTotals
  >

/**
 * Walk-forward over the previous 12 full months: each month is forecast from
 * data strictly before it. Per-type errors are reported, never gated on ±5%
 * of the household total.
 */
export function walkForward(
  transactions: Transaction[],
  budget: Budget,
  config: ForecastConfig,
  asOf: string,
  reimbursableParentTag: string = DEFAULT_REIMBURSABLE_PARENT,
): WalkForwardResult {
  const { past } = timelineMonths(asOf)
  const months: WalkForwardMonth[] = []

  for (const month of past) {
    const cutoff = `${month}-01`
    const prior = transactions.filter((transaction) => transaction.date < cutoff)
    if (prior.length === 0) continue

    const asOfPrior = monthPeriod(addMonths(month, -1)).end
    const result = forecast(prior, budget, config, asOfPrior, reimbursableParentTag)
    const point = result.cad.household.calendar.find((row) => row.month === month)
    const split = splitUniverse(
      transactions.filter((transaction) => transaction.date >= cutoff && transaction.date <= monthPeriod(month).end),
      config,
      reimbursableParentTag,
    )
    const actual = split.household
      .filter((transaction) => transaction.currency === 'CAD')
      .reduce((sum, transaction) => sum + signedSpend(transaction.amount), 0)

    const forecastTotal = point?.calendar ?? 0
    const byType = emptyTypes()
    const typesByKey = new Map(result.cad.household.categories.map((category) => [category.key, category.type]))
    const actualByCat = new Map<string, number>()
    for (const transaction of split.household) {
      if (transaction.currency !== 'CAD') continue
      const key = nameKey(transaction.category)
      actualByCat.set(key, (actualByCat.get(key) ?? 0) + signedSpend(transaction.amount))
    }
    for (const row of point?.byCategory ?? []) {
      const type = typesByKey.get(row.key) ?? row.type
      byType[type].forecast += row.forecast
      byType[type].count++
    }
    for (const [key, amount] of actualByCat) {
      const type = typesByKey.get(key) ?? 'irregular'
      byType[type].actual += amount
      if (!(point?.byCategory.some((row) => row.key === key))) byType[type].count++
    }

    const byCategory: WalkForwardCategory[] = []
    const seen = new Set<string>()
    for (const row of point?.byCategory ?? []) {
      seen.add(row.key)
      byCategory.push({
        key: row.key,
        label: row.label,
        forecast: row.forecast,
        actual: actualByCat.get(row.key) ?? row.actual,
      })
    }
    for (const [key, amount] of actualByCat) {
      if (seen.has(key)) continue
      byCategory.push({
        key,
        label: key,
        forecast: 0,
        actual: amount,
      })
    }

    months.push({
      month,
      actual,
      forecast: forecastTotal,
      error: actual - forecastTotal,
      byType,
      byCategory,
    })
  }

  const byType = Object.fromEntries(
    TYPES.map((type) => {
      const used = months.filter((row) => row.byType[type].count > 0 || row.byType[type].actual !== 0)
      const mae =
        used.length === 0
          ? 0
          : used.reduce((sum, row) => sum + Math.abs(row.byType[type].actual - row.byType[type].forecast), 0) /
            used.length
      return [type, { mae, months: used.length }]
    }),
  ) as WalkForwardResult['byType']

  return { months, byType }
}
