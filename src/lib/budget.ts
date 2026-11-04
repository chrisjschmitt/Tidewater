import { GROUPS, GROUP_BY_ID } from './categories'
import type { Budget, EveryTwoWeeks, ExpenseLine, Group, GroupId, IncomeLine } from './types'

export interface GroupSummary {
  group: Group
  total: number
  lines: ExpenseLine[]
  share: number
}

export const totalIncome = (b: Budget) =>
  b.income.reduce((sum, l) => sum + (l.amount || 0), 0)

export const totalExpenses = (b: Budget) =>
  b.expenses.reduce((sum, l) => sum + (l.amount || 0), 0)

export const totalGoalContributions = (b: Budget) =>
  b.goals.reduce((sum, g) => sum + (g.monthly || 0), 0)

/** What is left after planned spending and goal contributions. */
export const unallocated = (b: Budget) =>
  totalIncome(b) - totalExpenses(b) - totalGoalContributions(b)

/** Everything not spent on day-to-day life, whether or not it has a job yet. */
export const freeAfterExpenses = (b: Budget) => totalIncome(b) - totalExpenses(b)

/**
 * Group totals. With a month, lines paid every two weeks count that month's
 * payments (three in some months) rather than their average; the lines
 * themselves are returned unchanged, so editing them keeps their schedule.
 */
export function groupSummaries(b: Budget, month?: string): GroupSummary[] {
  const amountOf = (line: ExpenseLine) => (month ? lineAmountIn(line, month) : line.amount)
  const spend = b.expenses.reduce((sum, line) => sum + amountOf(line), 0)
  const byGroup = new Map<GroupId, ExpenseLine[]>()
  for (const line of b.expenses) {
    const list = byGroup.get(line.groupId) ?? []
    list.push(line)
    byGroup.set(line.groupId, list)
  }
  return GROUPS.map((group) => {
    const lines = (byGroup.get(group.id) ?? []).slice().sort((a, z) => z.amount - a.amount)
    const total = lines.reduce((sum, l) => sum + amountOf(l), 0)
    return { group, lines, total, share: spend > 0 ? total / spend : 0 }
  })
    .filter((g) => g.lines.length > 0)
    .sort((a, z) => z.total - a.total)
}

/**
 * Split the groups into the ones we show as bars and the remainder that gets
 * folded into a single expandable "everything else" row.
 */
export function splitForDisplay(summaries: GroupSummary[], visible: number) {
  const shown = summaries.slice(0, visible)
  const rest = summaries.slice(visible)
  const restTotal = rest.reduce((sum, g) => sum + g.total, 0)
  return { shown, rest, restTotal }
}

export function groupOf(id: GroupId): Group {
  return GROUP_BY_ID[id] ?? GROUP_BY_ID.other
}

/** A gentle, non-judgemental read on how the month is shaped. */
export function balanceTone(b: Budget): {
  key: 'over' | 'tight' | 'balanced' | 'room'
  headline: string
  detail: string
} {
  const income = totalIncome(b)
  const left = unallocated(b)
  const ratio = income > 0 ? left / income : 0

  if (left < 0) {
    return {
      key: 'over',
      headline: 'Your plan asks for a little more than arrives',
      detail: 'Nothing is broken. Adjust any group below until the numbers settle.',
    }
  }
  if (ratio < 0.02) {
    return {
      key: 'tight',
      headline: 'Every dollar has a job',
      detail: 'This works. A small cushion would make it feel easier.',
    }
  }
  if (ratio < 0.15) {
    return {
      key: 'balanced',
      headline: 'You have what you need, with room to breathe',
      detail: 'Consider pointing the remainder at something you care about.',
    }
  }
  return {
    key: 'room',
    headline: 'There is real room here',
    detail: 'This is yours to direct — a goal, a trip, or simply more ease.',
  }
}

// --- Every N weeks ---------------------------------------------------------
// (Named for every two weeks, the first and most common schedule.)

/** Paydays in a year for a line paid every two weeks. */
export const PAYDAYS_PER_YEAR = 26

const DAY_MS = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d ?? 1)
}

/** Weeks between payments: 1–8, two when the schedule doesn't say. */
export const scheduleWeeks = (schedule: Pick<EveryTwoWeeks, 'weeks'>): number => {
  const weeks = Math.round(schedule.weeks ?? 2)
  return weeks >= 1 && weeks <= 8 ? weeks : 2
}

/** Payments in a year: 26 every two weeks, 13 every four, 52 every week. */
export const paymentsPerYear = (weeks: number): number => 52 / weeks

/** "Every week", "Every two weeks", "Every 4 weeks". */
export const scheduleLabel = (schedule: Pick<EveryTwoWeeks, 'weeks'>): string => {
  const weeks = scheduleWeeks(schedule)
  return weeks === 1 ? 'Every week' : weeks === 2 ? 'Every two weeks' : `Every ${weeks} weeks`
}

/** The monthly average of a payment made every `weeks` weeks. */
export const everyTwoWeeksMonthly = (perPayment: number, weeks = 2): number =>
  round2((perPayment * paymentsPerYear(weeks)) / 12)

/** The payment that gives `monthly` on average, every `weeks` weeks. */
export const perPaymentFor = (monthly: number, weeks = 2): number => round2((monthly * 12) / paymentsPerYear(weeks))

/** How many payment dates fall in `month` (`YYYY-MM`) — e.g. every two weeks: two in most months, three in two a year. */
export function paydaysIn(schedule: Pick<EveryTwoWeeks, 'firstPayday' | 'weeks'>, month: string): number {
  const period = scheduleWeeks(schedule) * 7
  const start = utc(`${month}-01`)
  const [y, m] = month.split('-').map(Number)
  const end = Date.UTC(y!, m!, 1)
  const offset = Math.round((start - utc(schedule.firstPayday)) / DAY_MS)
  const first = start + ((((period - (offset % period)) % period) + period) % period) * DAY_MS
  let count = 0
  for (let day = first; day < end; day += period * DAY_MS) count++
  return count
}

/** The usual number of payments in a month: two every two weeks, one every four, four every week. */
export const usualPayments = (schedule: Pick<EveryTwoWeeks, 'weeks'>): number =>
  Math.floor(paymentsPerYear(scheduleWeeks(schedule)) / 12)

/** What a line plans for one month: its amount, or each payment date's payment for a line paid every few weeks. */
export function lineAmountIn(line: Pick<ExpenseLine | IncomeLine, 'amount' | 'everyTwoWeeks'>, month: string): number {
  if (!line.everyTwoWeeks) return line.amount || 0
  return round2(line.everyTwoWeeks.perPayment * paydaysIn(line.everyTwoWeeks, month))
}

/** Sets or clears the schedule, keeping `amount` as the monthly average. */
export function withEveryTwoWeeks<T extends ExpenseLine | IncomeLine>(line: T, schedule: EveryTwoWeeks | null): T {
  if (!schedule) {
    const { everyTwoWeeks: _gone, ...rest } = line
    return rest as T
  }
  const perPayment = Math.max(0, round2(schedule.perPayment))
  const weeks = scheduleWeeks(schedule)
  return {
    ...line,
    everyTwoWeeks: { perPayment, firstPayday: schedule.firstPayday, ...(weeks !== 2 ? { weeks } : {}) },
    amount: everyTwoWeeksMonthly(perPayment, weeks),
  }
}

/** Lines whose month has more (or fewer) payments than usual, for a note. */
export function paydayExtras(
  lines: Array<Pick<ExpenseLine | IncomeLine, 'name' | 'amount' | 'everyTwoWeeks'>>,
  month: string,
): Array<{ name: string; paydays: number; usual: number; amount: number; difference: number }> {
  return lines
    .filter((line) => line.everyTwoWeeks && line.everyTwoWeeks.perPayment > 0)
    .map((line) => {
      const amount = lineAmountIn(line, month)
      return {
        name: line.name,
        paydays: paydaysIn(line.everyTwoWeeks!, month),
        usual: usualPayments(line.everyTwoWeeks!),
        amount,
        difference: round2(amount - line.amount),
      }
    })
    .filter((extra) => extra.paydays !== extra.usual)
}

/**
 * The plan as it falls in one month: lines paid every two weeks carry that
 * month's payments instead of their average. For the dashboard's own totals;
 * goal suggestions keep using the average, since a goal contribution repeats
 * every month.
 */
export function inMonth(b: Budget, month: string): Budget {
  if (!b.expenses.some((line) => line.everyTwoWeeks) && !b.income.some((line) => line.everyTwoWeeks)) return b
  return {
    ...b,
    expenses: b.expenses.map((line) => (line.everyTwoWeeks ? { ...line, amount: lineAmountIn(line, month) } : line)),
    income: b.income.map((line) => (line.everyTwoWeeks ? { ...line, amount: lineAmountIn(line, month) } : line)),
  }
}

/**
 * Something the plan holds for this month only, beyond the budget's lines:
 * a one-month raise (or cut) of a category, or a dated cost pinned on the
 * month. Known only while expense tracking is unlocked, which keeps them.
 */
export interface MonthPlanAdjustment {
  label: string
  /** The plan category it belongs to, to place it in its group. */
  category: string
  amount: number
  kind: 'raise' | 'dated'
}

/** Group totals with this month's adjustments added to the group holding their category (else left out of the bars). */
export function withAdjustments(summaries: GroupSummary[], adjustments: MonthPlanAdjustment[]): GroupSummary[] {
  if (adjustments.length === 0) return summaries
  const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
  const totals = summaries.map((summary) => {
    const names = new Set(summary.lines.map((line) => key(line.name)))
    const extra = adjustments.filter((item) => names.has(key(item.category))).reduce((sum, item) => sum + item.amount, 0)
    return { ...summary, total: summary.total + extra }
  })
  const spend = totals.reduce((sum, summary) => sum + summary.total, 0)
  return totals.map((summary) => ({ ...summary, share: spend > 0 ? summary.total / spend : 0 })).sort((a, z) => z.total - a.total)
}
