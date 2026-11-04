import { lineAmountIn, paydaysIn, perPaymentFor, scheduleWeeks } from '../budget'
import { groupForCategory, isEssentialCategory } from '../categories'
import type { Budget, EveryTwoWeeks, ExpenseLine } from '../types'
import { withChangeNote } from './planNotes'
import type { ForecastConfig } from './types'

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
  /**
   * The line was paid every few weeks then: each month's plan is this
   * payment times that month's payment dates, not the flat `amount` (which
   * holds the average).
   */
  schedule?: EveryTwoWeeks
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

/** The budget's amount for a category in one month: lines paid every two weeks count that month's paydays. */
export function budgetAmountIn(budget: Budget, key: string, month: string): number {
  return round2(
    budget.expenses.filter((line) => planKey(line.name) === key).reduce((sum, line) => sum + lineAmountIn(line, month), 0),
  )
}

/** The plan for one category in one month. */
export function planAmountAt(budget: Budget, history: PlanHistory | undefined, key: string, month: string): number {
  const era = eraFor(history?.[key], month)
  return era ? eraAmountIn(era, month) : budgetAmountIn(budget, key, month)
}

/** An entry's plan for one month: its payments that month when it was paid every few weeks. */
function eraAmountIn(era: PlanEra, month: string): number {
  return era.schedule ? round2(era.schedule.perPayment * paydaysIn(era.schedule, month)) : era.amount
}

/** What the budget itself plans for a category, as an entry: with its schedule when paid every few weeks. */
function budgetSource(budget: Budget, key: string): Omit<PlanEra, 'until'> {
  const schedule = budget.expenses.find((line) => planKey(line.name) === key && line.everyTwoWeeks)?.everyTwoWeeks
  return { amount: budgetAmount(budget, key), ...(schedule ? { schedule } : {}) }
}

const sameSource = (a: Omit<PlanEra, 'until'>, z: Omit<PlanEra, 'until'>): boolean =>
  a.amount === z.amount && JSON.stringify(a.schedule ?? null) === JSON.stringify(z.schedule ?? null)

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
  const paidEveryTwoWeeks = budget.expenses.some((line) => line.everyTwoWeeks)
  if ((!history || Object.keys(history).length === 0) && !paidEveryTwoWeeks) return budget
  // Lines paid every two weeks carry that month's paydays, not their average.
  let expenses = paidEveryTwoWeeks
    ? budget.expenses.map((line) => {
        if (!line.everyTwoWeeks) return line
        const { everyTwoWeeks: _schedule, ...rest } = line
        return { ...rest, amount: lineAmountIn(line, month) }
      })
    : budget.expenses
  for (const [key, entry] of Object.entries(history ?? {})) {
    const era = eraFor(entry, month)
    if (!era) continue
    expenses = withAmount(expenses, key, entry.label, eraAmountIn(era, month))
  }
  return expenses === budget.expenses ? budget : { ...budget, expenses }
}

/**
 * A budget for a span of months, for comparisons that multiply a monthly plan
 * by the number of months: each category carries its average over the span,
 * so the product is the sum of what each month actually planned.
 */
export function budgetOver(budget: Budget, history: PlanHistory | undefined, months: string[]): Budget {
  const paidEveryTwoWeeks = budget.expenses.filter((line) => line.everyTwoWeeks)
  if (months.length === 0 || ((!history || Object.keys(history).length === 0) && paidEveryTwoWeeks.length === 0)) return budget
  if (months.length === 1) return budgetAt(budget, history, months[0]!)
  const keys = new Map<string, string>()
  for (const [key, entry] of Object.entries(history ?? {})) {
    if (months.some((month) => eraFor(entry, month))) keys.set(key, entry.label)
  }
  for (const line of paidEveryTwoWeeks) keys.set(planKey(line.name), line.name)
  let expenses = budget.expenses.map((line) => {
    if (!line.everyTwoWeeks) return line
    const { everyTwoWeeks: _schedule, ...rest } = line
    return rest
  })
  for (const [key, label] of keys) {
    const average = months.reduce((sum, month) => sum + planAmountAt(budget, history, key, month), 0) / months.length
    expenses = withAmount(expenses, key, label, round2(average))
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
  change: { key: string; label: string; month: string; amount: number; perPayment?: number },
): { budget: Budget; history: PlanHistory } {
  const { key, label, month } = change
  const amount = round2(Math.max(0, change.amount))
  const eras = [...(history?.[key]?.eras ?? [])].sort((a, z) => a.until.localeCompare(z.until))
  const kept = eras.filter((era) => era.until < month)
  const covering = eras.find((era) => era.until >= month)
  const coveringBefore: Omit<PlanEra, 'until'> = covering
    ? { amount: covering.amount, ...(covering.schedule ? { schedule: covering.schedule } : {}) }
    : budgetSource(budget, key)
  const lastKept = kept.at(-1)?.until
  // Months between the last kept entry and `month` exist only if `month` is
  // after it; record what they had unless it already equals the new amount
  // (a line paid every few weeks is always recorded: its months vary).
  const needsEra = (coveringBefore.schedule || coveringBefore.amount !== amount) && (!lastKept || lastKept < month)
  const nextEras = needsEra ? [...kept, { until: month, ...coveringBefore }] : kept

  const nextHistory: PlanHistory = { ...(history ?? {}) }
  if (nextEras.length > 0) nextHistory[key] = { label, eras: nextEras }
  else delete nextHistory[key]

  return {
    budget: { ...budget, expenses: withAmount(budget.expenses, key, label, amount, change.perPayment) },
    history: nextHistory,
  }
}

/**
 * Change one category's plan for `month` only. The months before and after
 * keep whatever they had, including changes already scheduled later, and the
 * budget itself is untouched — so only the history changes.
 */
export function withPlanForMonth(
  budget: Budget,
  history: PlanHistory | undefined,
  change: { key: string; label: string; month: string; amount: number },
): PlanHistory {
  const { key, label, month } = change
  const amount = round2(Math.max(0, change.amount))
  const after = shiftMonth(month, 1)
  // What a stretch of months held: the month itself takes the new amount;
  // others keep their entry, or the budget's own line (schedule and all).
  const sourceAt = (m: string): Omit<PlanEra, 'until'> => {
    if (m === month) return { amount }
    const era = eraFor(history?.[key], m)
    return era ? { amount: era.amount, ...(era.schedule ? { schedule: era.schedule } : {}) } : budgetSource(budget, key)
  }
  // Each boundary ends a stretch of months with one source: the stretch
  // before the first boundary, then each boundary up to the next.
  const bounds = [...new Set([...(history?.[key]?.eras ?? []).map((era) => era.until), month, after])].sort()
  const eras: PlanEra[] = []
  bounds.forEach((until, i) => {
    const source = sourceAt(i === 0 ? shiftMonth(until, -1) : bounds[i - 1]!)
    const last = eras.at(-1)
    if (last && sameSource(last, source)) last.until = until
    else eras.push({ until, ...source })
  })
  const going = budgetSource(budget, key)
  while (eras.length > 0 && sameSource(eras.at(-1)!, going)) eras.pop()

  const next: PlanHistory = { ...(history ?? {}) }
  if (eras.length > 0) next[key] = { label, eras }
  else delete next[key]
  return next
}

/**
 * Plan-only pins (before 0.13.12) raised a month's Plan inside the Forecast
 * tab alone, so the Budget tab and the dashboard disagreed with it. Each one
 * becomes the same raise as a plan change for its month only, and the pin
 * goes. Returns undefined when there is nothing to move.
 */
export function withPlanPinsAsPlans(budget: Budget, config: ForecastConfig): ForecastConfig | undefined {
  const moving = config.knownFutures.filter(
    (future) => future.addsTo === 'plan' && future.recurrence === 'once' && (future.series ?? 'household') === 'household',
  )
  if (moving.length === 0) return undefined
  let history = config.planHistory
  let notes = config.planNotes
  for (const future of moving) {
    const key = planKey(future.category)
    const amount = planAmountAt(budget, history, key, future.month) + future.amount
    history = withPlanForMonth(budget, history, { key, label: future.category, month: future.month, amount })
    // The pin's comment becomes the raise's note.
    if (future.notes.trim()) {
      notes = withChangeNote(notes, { key, label: future.category, month: future.month, text: future.notes })
    }
  }
  const moved = new Set(moving.map((future) => future.id))
  return {
    ...config,
    knownFutures: config.knownFutures.filter((future) => !moved.has(future.id)),
    ...(history ? { planHistory: history } : {}),
    ...(notes ? { planNotes: notes } : {}),
  }
}

/** `YYYY-MM` moved by whole months. */
function shiftMonth(month: string, by: number): string {
  const [year, mm] = month.split('-').map(Number)
  const index = year! * 12 + (mm! - 1) + by
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** First line of the category carries the amount; any others are zeroed. A missing category gets a line. */
function withAmount(
  expenses: ExpenseLine[],
  key: string,
  label: string,
  amount: number,
  /** For a line paid every few weeks: the payment itself, so no cent is lost converting from the average. */
  perPayment?: number,
): ExpenseLine[] {
  let placed = false
  const next = expenses.map((line) => {
    if (planKey(line.name) !== key) return line
    if (placed) return line.amount === 0 ? line : { ...line, amount: 0 }
    placed = true
    if (line.amount === amount && (perPayment === undefined || line.everyTwoWeeks?.perPayment === perPayment)) return line
    // A line paid every two weeks keeps its schedule: the new monthly
    // average becomes a new payment per payday.
    if (line.everyTwoWeeks) {
      const payment = perPayment ?? perPaymentFor(amount, scheduleWeeks(line.everyTwoWeeks))
      return { ...line, amount, everyTwoWeeks: { ...line.everyTwoWeeks, perPayment: Math.max(0, payment) } }
    }
    return { ...line, amount }
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
