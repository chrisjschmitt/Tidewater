import { inMonth, totalIncome } from '../budget'
import type { Budget } from '../types'
import { savingsTone, withCompareIgnores } from './forecast'
import type { CurrentMonthView, MonthPoint } from './types'

/**
 * The household's point: what each month can put toward travel. Forecast
 * saving is the plan's income for the month less the forecast spend (forecast
 * to month-end for this month, the calendar forecast for later ones — the
 * same figure the month card shows, ignored rows taken out), measured against
 * the Vacation goal's monthly contribution.
 */

export interface TravelMonth {
  month: string
  kind: 'current' | 'future'
  income: number
  forecast: number
  saving: number
  target: number
  tone: 'met' | 'close' | 'short' | 'none'
}

const cents = (n: number) => Math.round(n * 100) / 100

export function travelOutlook(
  calendar: MonthPoint[],
  current: CurrentMonthView,
  budget: Budget,
  target: number,
  ignored: Record<string, string[]> = {},
  months = 6,
): TravelMonth[] {
  const ahead = calendar.filter((point) => point.kind === 'current' || point.kind === 'future').slice(0, months)
  return ahead.map((point) => {
    const isCurrent = point.kind === 'current'
    const plan = isCurrent ? current.plan : point.plan
    const raw = isCurrent ? current.forecastEom : point.calendar
    const compare = (isCurrent ? current.planVsForecast : point.planVsForecast) ?? []
    const forecast = withCompareIgnores(plan, raw, compare, ignored[point.month] ?? []).forecast
    const income = cents(totalIncome(inMonth(budget, point.month)))
    const saving = cents(income - forecast)
    return {
      month: point.month,
      kind: isCurrent ? 'current' : 'future',
      income,
      forecast,
      saving,
      target,
      tone: savingsTone(saving, target),
    }
  })
}
