import { groupForCategory, isEssentialCategory } from '../categories'
import type { Budget, ExpenseLine } from '../types'

/**
 * When a category's plan changes from a given month on, the months before it
 * must keep the plan they had. The budget itself only ever holds one amount
 * per line — the plan going forward, which the dashboard and its sliders
 * show — so the earlier amounts are kept here, in expense tracking's own
 * encrypted settings:
 *
 *     groceries: [{ until: '2026-10', amount: 800 }]   // months before Oct: 800
 *
 * A month with no entry whose `until` lies after it uses the budget as it is.
 */
export interface PlanEra {
  /** First month this amount no longer applies to, `YYYY-MM`. */
  until: string
  amount: number
}

export interface PlanHistoryEntry {
  label: string
  eras: PlanEra[]
}

export type PlanHistory = Record<string, PlanHistoryEntry>

/** The same pairing the forecast and the Budget tab use: case and spacing ignored. */
export const planKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ')

const round2 = (n: number) => Math.round(n * 100) / 100

/** The budget's own amount for a category: every line of that name, summed. */
export function budgetAmount(budget: Budget, key: string): number {
  return round2(
    budget.expenses.filter((line) => planKey(line.name) === key).reduce((sum, line) => sum + (line.amount || 0), 0),
  )
}

/** The plan for one category in one month. */
export function planAmountAt(budget: Budget, history: PlanHistory | undefined, key: string, month: string): number {
  const era = eraFor(history?.[key], month)
  return era ? era.amount : budgetAmount(budget, key)
}

function eraFor(entry: PlanHistoryEntry | undefined, month: string): PlanEra | undefined {
  if (!entry) return undefined
  return [...entry.eras].sort((a, z) => a.until.localeCompare(z.until)).find((era) => month < era.until)
}

/**
 * The budget as it stood for `month`: every category whose plan has changed
 * since carries the amount it had then. Lines are never removed, so groups and
 * order stay as the user arranged them.
 */
export function budgetAt(budget: Budget, history: PlanHistory | undefined, month: string): Budget {
  if (!history || Object.keys(history).length === 0) return budget
  let expenses = budget.expenses
  for (const [key, entry] of Object.entries(history)) {
    const era = eraFor(entry, month)
    if (!era) continue
    expenses = withAmount(expenses, key, entry.label, era.amount)
  }
  return expenses === budget.expenses ? budget : { ...budget, expenses }
}

/**
 * A budget for a span of months, for comparisons that multiply a monthly plan
 * by the number of months: each category carries its average over the span,
 * so the product is the sum of what each month actually planned.
 */
export function budgetOver(budget: Budget, history: PlanHistory | undefined, months: string[]): Budget {
  if (!history || Object.keys(history).length === 0 || months.length === 0) return budget
  if (months.length === 1) return budgetAt(budget, history, months[0]!)
  let expenses = budget.expenses
  for (const [key, entry] of Object.entries(history)) {
    if (!months.some((month) => eraFor(entry, month))) continue
    const average = months.reduce((sum, month) => sum + planAmountAt(budget, history, key, month), 0) / months.length
    expenses = withAmount(expenses, key, entry.label, round2(average))
  }
  return { ...budget, expenses }
}

/**
 * Change one category's plan from `month` on. Earlier months keep what they
 * had: whatever covered them before — an older entry, or the budget's current
 * amount — is written down as an entry ending at `month`. Any change scheduled
 * after `month` is replaced, since the new amount holds from `month` on.
 * Returns the new history and the budget with the new amount.
 */
export function withPlanChange(
  budget: Budget,
  history: PlanHistory | undefined,
  change: { key: string; label: string; month: string; amount: number },
): { budget: Budget; history: PlanHistory } {
  const { key, label, month } = change
  const amount = round2(Math.max(0, change.amount))
  const eras = [...(history?.[key]?.eras ?? [])].sort((a, z) => a.until.localeCompare(z.until))
  const kept = eras.filter((era) => era.until < month)
  const coveringBefore = eras.find((era) => era.until >= month)?.amount ?? budgetAmount(budget, key)
  const lastKept = kept.at(-1)?.until
  // Months between the last kept entry and `month` exist only if `month` is
  // after it; record what they had unless it already equals the new amount.
  const needsEra = coveringBefore !== amount && (!lastKept || lastKept < month)
  const nextEras = needsEra ? [...kept, { until: month, amount: coveringBefore }] : kept

  const nextHistory: PlanHistory = { ...(history ?? {}) }
  if (nextEras.length > 0) nextHistory[key] = { label, eras: nextEras }
  else delete nextHistory[key]

  return {
    budget: { ...budget, expenses: withAmount(budget.expenses, key, label, amount) },
    history: nextHistory,
  }
}

/** First line of the category carries the amount; any others are zeroed. A missing category gets a line. */
function withAmount(expenses: ExpenseLine[], key: string, label: string, amount: number): ExpenseLine[] {
  let placed = false
  const next = expenses.map((line) => {
    if (planKey(line.name) !== key) return line
    if (placed) return line.amount === 0 ? line : { ...line, amount: 0 }
    placed = true
    return line.amount === amount ? line : { ...line, amount }
  })
  if (placed || amount === 0) return next
  return [
    ...next,
    {
      id: `plan-${key.replace(/[^a-z0-9]+/g, '-')}`,
      name: label,
      groupId: groupForCategory(label),
      amount,
      baseline: amount,
      essential: isEssentialCategory(label),
    },
  ]
}
