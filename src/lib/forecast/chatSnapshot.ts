import { compareToBudget, bucketLabel, bucketOf, isReimbursable, type PeriodActuals } from '../etm/aggregate'
import { includes } from '../etm/period'
import { DEFAULT_CONFIG } from '../etm/config'
import type { Transaction } from '../etm/types'
import { totalExpenses } from '../budget'
import type { Budget } from '../types'
import type { ForecastResult, CategoryForecast, HouseholdForecast, MonthPoint, VacationForecast } from './types'
import type {
  ChatExpenseType,
  ChatForecastCategory,
  ChatHouseholdBlock,
  ChatMoney,
  ChatReimbursableBlock,
  ChatReimbursableBucket,
  ChatReimbursableCategory,
  ChatReimbursableMonth,
  ChatRemainReason,
  ChatVacationBlock,
  EtmChatSnapshot,
} from '../etmChat'

/**
 * Compact chat snapshot from numbers ETM and Forecast already compute.
 * Call only from the lazy ETM chunk — never from App.tsx.
 */

export function buildChatSnapshot(input: {
  budget: Budget
  actuals: PeriodActuals
  periodLabel: string
  forecast: ForecastResult
  transactions?: Transaction[]
  reimbursableTag?: string
}): EtmChatSnapshot {
  const comparison = compareToBudget(input.budget, input.actuals)
  const { forecast } = input
  const parentTag = input.reimbursableTag ?? DEFAULT_CONFIG.reimbursableTag

  return {
    asOf: forecast.asOf,
    periodLabel: input.periodLabel,
    periodMonths: input.actuals.months,
    windowLabel: forecast.windowLabel,
    lookbackFirst: forecast.lookback[0] ?? '',
    lookbackLast: forecast.lookback[forecast.lookback.length - 1] ?? '',
    lookbackCount: forecast.lookback.length,
    typicalMonthPlanCad: totalExpenses(input.budget),
    budgetTab: {
      series: 'budget-tab-actuals',
      income: moneyOf(input.actuals.income),
      spend: moneyOf(input.actuals.spend),
      reimbursableHeldOut: moneyOf(input.actuals.reimbursable.spend),
      plannedTotalCad: comparison.plannedTotal,
      groups: comparison.groups.map((group) => ({
        group: group.group.name,
        plannedCad: group.planned,
        actual: moneyOf(group.actual),
        categories: group.categories.map((category) => ({
          name: category.name,
          plannedCad: category.planned,
          actual: moneyOf(category.actual),
        })),
      })),
    },
    reimbursableTab: reimbursableBlock(input.actuals, input.transactions ?? [], parentTag, forecast),
    forecast: {
      householdCad: householdBlock(forecast.cad.household, 'CAD'),
      vacationCad: vacationBlock(forecast.cad.vacation, 'CAD'),
      householdUsd: includeCurrency(forecast.usd.household) ? householdBlock(forecast.usd.household, 'USD') : undefined,
      vacationUsd: includeVacation(forecast.usd.vacation) ? vacationBlock(forecast.usd.vacation, 'USD') : undefined,
      categories: [
        ...forecastCategories(forecast.cad.household.categories, 'forecast-household', 'CAD', forecast.cad.household.calendar),
        ...forecastCategories(forecast.cad.vacation.categories, 'forecast-vacation', 'CAD'),
        ...forecastCategories(forecast.usd.household.categories, 'forecast-household', 'USD', forecast.usd.household.calendar),
        ...forecastCategories(forecast.usd.vacation.categories, 'forecast-vacation', 'USD'),
      ],
    },
  }
}

function moneyOf(value: { CAD: number; USD: number }): ChatMoney {
  return { CAD: value.CAD, USD: value.USD }
}

function householdBlock(household: HouseholdForecast, currency: 'CAD' | 'USD'): ChatHouseholdBlock {
  return {
    series: 'forecast-household',
    currency,
    setAsideLikely: household.setAside.likely,
    setAsideHigh: household.setAside.high,
    overlayMonthly: household.overlay.monthly,
    overlayLines: household.overlay.lines.map((line) => ({
      label: line.label,
      share: line.share,
      lowSample: line.lowSample,
    })),
    currentMonth: {
      month: household.currentMonth.month,
      actualToDate: household.currentMonth.actualToDate,
      remain: household.currentMonth.remain,
      forecastEom: household.currentMonth.forecastEom,
      plan: household.currentMonth.plan,
      overlay: household.currentMonth.overlay,
      remainLines: household.currentMonth.remainLines.map((line) => ({
        label: line.label,
        remain: line.remain,
        reason: line.reason as ChatRemainReason,
      })),
    },
  }
}

function vacationBlock(vacation: VacationForecast, currency: 'CAD' | 'USD'): ChatVacationBlock {
  const current = vacation.months.find((month) => month.kind === 'current')
  return {
    series: 'forecast-vacation',
    currency,
    pot: vacation.pot,
    monthlyContribution: vacation.monthlyContribution,
    currentMonthPaused: vacation.currentMonthPaused,
    currentMonthActual: current?.actual ?? 0,
    currentMonthForecast: current?.forecast ?? 0,
  }
}

function forecastCategories(
  categories: CategoryForecast[],
  series: ChatForecastCategory['series'],
  currency: ChatForecastCategory['currency'],
  calendar?: MonthPoint[],
): ChatForecastCategory[] {
  return categories.map((category) => ({
    series,
    currency,
    label: category.label,
    type: category.type as ChatExpenseType,
    likely: category.likely,
    typicalMonths: category.typicalMonthNames,
    lowSample: category.lowSample,
    windowTotal: category.windowTotal,
    average12: category.average12,
    average24: category.average24,
    monthsPresent: category.monthsPresent,
    monthlyActuals: monthlyActualsFor(category.key, calendar),
  }))
}

function monthlyActualsFor(
  key: string,
  calendar?: MonthPoint[],
): Array<{ month: string; actual: number }> {
  if (!calendar) return []
  return calendar
    .filter((point) => point.kind === 'past' || point.kind === 'current')
    .map((point) => ({
      month: point.month,
      actual: point.byCategory.find((row) => row.key === key)?.actual ?? 0,
    }))
    .filter((row) => row.actual !== 0)
}

function includeCurrency(household: HouseholdForecast): boolean {
  return (
    household.categories.length > 0 ||
    household.currentMonth.actualToDate !== 0 ||
    household.setAside.likely !== 0
  )
}

function includeVacation(vacation: VacationForecast): boolean {
  return vacation.categories.length > 0 || vacation.pot !== 0 || vacation.monthlyContribution !== 0
}

function reimbursableBlock(
  actuals: PeriodActuals,
  transactions: Transaction[],
  parentTag: string,
  forecast: ForecastResult,
): ChatReimbursableBlock {
  const months = forecastStripMonths(forecast)
  const history = reimbursableMonthly(transactions, months, parentTag)
  const periodByLabel = new Map(actuals.reimbursable.buckets.map((bucket) => [bucket.label, moneyOf(bucket.spend)]))
  const labels = new Set([...periodByLabel.keys(), ...history.byBucket.keys()])
  const buckets: ChatReimbursableBucket[] = [...labels].map((label) => ({
    label,
    spend: periodByLabel.get(label) ?? { CAD: 0, USD: 0 },
    monthlyActuals: nonzeroMonths(history.byBucket.get(label) ?? []),
  }))
  buckets.sort((a, z) => z.spend.CAD - a.spend.CAD || z.spend.USD - a.spend.USD || a.label.localeCompare(z.label))

  return {
    series: 'reimbursable-tab',
    spend: moneyOf(actuals.reimbursable.spend),
    buckets,
    categories: reimbursableCategories(transactions, actuals, parentTag),
    monthlyActuals: nonzeroMonths(history.totals),
  }
}

function forecastStripMonths(forecast: ForecastResult): string[] {
  const fromCal = forecast.cad.household.calendar
    .filter((point) => point.kind === 'past' || point.kind === 'current')
    .map((point) => point.month)
  if (fromCal.length > 0) return fromCal
  const current = forecast.asOf.slice(0, 7)
  return [...forecast.lookback.slice(-12), current].filter((month, index, all) => all.indexOf(month) === index)
}

function reimbursableMonthly(
  transactions: Transaction[],
  months: string[],
  parentTag: string,
): { totals: ChatReimbursableMonth[]; byBucket: Map<string, ChatReimbursableMonth[]> } {
  const monthSet = new Set(months)
  const totals = new Map<string, ChatMoney>()
  const byBucket = new Map<string, Map<string, ChatMoney>>()
  for (const month of months) totals.set(month, { CAD: 0, USD: 0 })

  for (const transaction of transactions) {
    if (transaction.internal) continue
    if (!isReimbursable(transaction, parentTag)) continue
    const month = transaction.date.slice(0, 7)
    if (!monthSet.has(month)) continue
    const amount = -transaction.amount
    const total = totals.get(month) ?? { CAD: 0, USD: 0 }
    total[transaction.currency] += amount
    totals.set(month, total)
    const label = bucketLabel(bucketOf(transaction, parentTag))
    const bucketMonths = byBucket.get(label) ?? new Map<string, ChatMoney>()
    const cell = bucketMonths.get(month) ?? { CAD: 0, USD: 0 }
    cell[transaction.currency] += amount
    bucketMonths.set(month, cell)
    byBucket.set(label, bucketMonths)
  }

  return {
    totals: months.map((month) => ({ month, actual: totals.get(month) ?? { CAD: 0, USD: 0 } })),
    byBucket: new Map(
      [...byBucket.entries()].map(([label, cells]) => [
        label,
        months.map((month) => ({ month, actual: cells.get(month) ?? { CAD: 0, USD: 0 } })),
      ]),
    ),
  }
}

function reimbursableCategories(
  transactions: Transaction[],
  actuals: PeriodActuals,
  parentTag: string,
): ChatReimbursableCategory[] {
  const byName = new Map<string, ChatReimbursableCategory>()
  for (const transaction of transactions) {
    if (transaction.internal) continue
    if (!includes(actuals.period, transaction.date)) continue
    if (!isReimbursable(transaction, parentTag)) continue
    const name = transaction.category.trim() || 'Uncategorized'
    const key = name.toLowerCase()
    const row = byName.get(key) ?? { name, spend: { CAD: 0, USD: 0 } }
    row.spend[transaction.currency] += -transaction.amount
    byName.set(key, row)
  }
  return [...byName.values()]
    .filter((row) => row.spend.CAD !== 0 || row.spend.USD !== 0)
    .sort((a, z) => z.spend.CAD - a.spend.CAD || z.spend.USD - a.spend.USD || a.name.localeCompare(z.name))
}

function nonzeroMonths(rows: ChatReimbursableMonth[]): ChatReimbursableMonth[] {
  return rows.filter((row) => row.actual.CAD !== 0 || row.actual.USD !== 0)
}
