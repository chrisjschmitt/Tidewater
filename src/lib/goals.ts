import type { Goal } from './types'

export interface ProjectionPoint {
  month: number
  balance: number
  contributed: number
}

const MAX_MONTHS = 12 * 40

/**
 * Month-by-month balance for a savings goal, compounding monthly at
 * `annualRate` and adding `monthly` at the end of each month.
 */
export function projectSavings(goal: Goal, months: number): ProjectionPoint[] {
  const r = goal.annualRate / 100 / 12
  const points: ProjectionPoint[] = []
  let balance = goal.current
  let contributed = goal.current
  points.push({ month: 0, balance, contributed })
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + r) + goal.monthly
    contributed += goal.monthly
    points.push({ month: m, balance, contributed })
  }
  return points
}

/** Remaining balance on a debt as it is paid down. */
export function projectDebt(goal: Goal, months: number): ProjectionPoint[] {
  const r = goal.annualRate / 100 / 12
  const points: ProjectionPoint[] = []
  let balance = goal.current
  let contributed = 0
  points.push({ month: 0, balance, contributed })
  for (let m = 1; m <= months; m++) {
    if (balance <= 0) {
      points.push({ month: m, balance: 0, contributed })
      continue
    }
    const interest = balance * r
    balance = Math.max(0, balance + interest - goal.monthly)
    contributed += goal.monthly
    points.push({ month: m, balance, contributed })
  }
  return points
}

export function project(goal: Goal, months: number): ProjectionPoint[] {
  return goal.kind === 'debt' ? projectDebt(goal, months) : projectSavings(goal, months)
}

/** Months until a savings goal reaches its target, or Infinity if it never does. */
export function monthsToTarget(goal: Goal): number {
  if (goal.kind === 'debt') return monthsToPayoff(goal)
  if (goal.current >= goal.target) return 0
  if (goal.monthly <= 0 && goal.annualRate <= 0) return Infinity

  const r = goal.annualRate / 100 / 12
  let balance = goal.current
  for (let m = 1; m <= MAX_MONTHS; m++) {
    balance = balance * (1 + r) + goal.monthly
    if (balance >= goal.target) return m
  }
  return Infinity
}

/** Months until a debt hits zero, or Infinity if the payment never catches the interest. */
export function monthsToPayoff(goal: Goal): number {
  const r = goal.annualRate / 100 / 12
  let balance = goal.current
  if (balance <= 0) return 0
  if (goal.monthly <= balance * r) return Infinity
  for (let m = 1; m <= MAX_MONTHS; m++) {
    balance = balance * (1 + r) - goal.monthly
    if (balance <= 0) return m
  }
  return Infinity
}

/** Total interest earned (savings) or paid (debt) over the life of the goal. */
export function interestOverHorizon(goal: Goal, months: number): number {
  const points = project(goal, months)
  const last = points[points.length - 1]
  if (goal.kind === 'debt') {
    const principalPaid = goal.current - last.balance
    return Math.max(0, last.contributed - principalPaid)
  }
  return last.balance - last.contributed
}

export function progressToward(goal: Goal): number {
  if (goal.kind === 'debt') {
    const original = Math.max(goal.current, 1)
    return 1 - goal.current / original
  }
  if (goal.target <= 0) return 0
  return Math.min(1, goal.current / goal.target)
}
