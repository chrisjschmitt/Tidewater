import { uid } from './format'
import type { Budget, ExpenseLine, GroupId, Profile } from './types'

export interface StarterAnswers {
  name: string
  region: string
  monthlyIncome: number
  housing: 'rent' | 'own' | 'other'
  housingCost: number
  household: 'single' | 'partnered'
  dependents: number
  hasDebt: boolean
  debtBalance: number
  debtPayment: number
}

export const EMPTY_ANSWERS: StarterAnswers = {
  name: '',
  region: '',
  monthlyIncome: 0,
  housing: 'rent',
  housingCost: 0,
  household: 'single',
  dependents: 0,
  hasDebt: false,
  debtBalance: 0,
  debtPayment: 0,
}

/**
 * Typical share of take-home pay, used only to give someone a believable
 * starting point. Every line is meant to be moved afterwards.
 */
const SHARES: Array<{ name: string; groupId: GroupId; share: number; essential: boolean }> = [
  { name: 'Utilities', groupId: 'home', share: 0.035, essential: true },
  { name: 'Internet & phone', groupId: 'home', share: 0.025, essential: true },
  { name: 'Home insurance', groupId: 'home', share: 0.008, essential: true },
  { name: 'Groceries', groupId: 'food', share: 0.1, essential: true },
  { name: 'Coffee & snacks', groupId: 'food', share: 0.01, essential: false },
  { name: 'Vehicle or transit', groupId: 'transport', share: 0.07, essential: true },
  { name: 'Fuel', groupId: 'transport', share: 0.03, essential: false },
  { name: 'Vehicle insurance', groupId: 'transport', share: 0.025, essential: true },
  { name: 'Health & pharmacy', groupId: 'health', share: 0.02, essential: true },
  { name: 'Fitness & wellbeing', groupId: 'health', share: 0.012, essential: false },
  { name: 'Clothing & personal care', groupId: 'personal', share: 0.025, essential: false },
  { name: 'Subscriptions', groupId: 'personal', share: 0.01, essential: false },
  { name: 'Household supplies', groupId: 'personal', share: 0.012, essential: false },
  { name: 'Restaurants', groupId: 'joy', share: 0.04, essential: false },
  { name: 'Entertainment & hobbies', groupId: 'joy', share: 0.025, essential: false },
  { name: 'Gifts', groupId: 'joy', share: 0.01, essential: false },
  { name: 'Bank fees', groupId: 'financial', share: 0.004, essential: true },
  { name: 'Giving', groupId: 'future', share: 0.01, essential: false },
]

const PER_DEPENDENT: Array<{ name: string; groupId: GroupId; share: number }> = [
  { name: 'Childcare & school', groupId: 'family', share: 0.06 },
  { name: 'Kids’ clothing & activities', groupId: 'family', share: 0.02 },
]

const roundTo = (n: number, step: number) => Math.max(0, Math.round(n / step) * step)

export function buildStarterBudget(a: StarterAnswers): Budget {
  const income = Math.max(0, a.monthlyIncome)
  const housingCost = a.housingCost > 0 ? a.housingCost : income * 0.32

  const expenses: ExpenseLine[] = [
    {
      id: uid('exp'),
      name: a.housing === 'own' ? 'Mortgage' : a.housing === 'rent' ? 'Rent' : 'Housing',
      groupId: 'home',
      amount: roundTo(housingCost, 25),
      essential: true,
    },
  ]

  if (a.housing === 'own') {
    expenses.push({
      id: uid('exp'),
      name: 'Property tax & upkeep',
      groupId: 'home',
      amount: roundTo(income * 0.05, 25),
      essential: true,
    })
  }

  // A partnered household shares fixed costs, so the per-person shares ease off.
  const householdFactor = a.household === 'partnered' ? 1.35 : 1

  for (const s of SHARES) {
    const amount = roundTo(income * s.share * (s.groupId === 'home' ? 1 : householdFactor) * 0.85, 5)
    if (amount <= 0) continue
    expenses.push({ id: uid('exp'), name: s.name, groupId: s.groupId, amount, essential: s.essential })
  }

  for (let i = 0; i < a.dependents; i++) {
    for (const d of PER_DEPENDENT) {
      const existing = expenses.find((e) => e.name === d.name)
      const amount = roundTo(income * d.share, 25)
      if (existing) existing.amount += amount
      else
        expenses.push({
          id: uid('exp'),
          name: d.name,
          groupId: d.groupId,
          amount,
          essential: true,
        })
    }
  }

  if (a.hasDebt && a.debtPayment > 0) {
    expenses.push({
      id: uid('exp'),
      name: 'Debt payment',
      groupId: 'financial',
      amount: roundTo(a.debtPayment, 5),
      essential: true,
    })
  }

  // Keep the starting plan inside what actually arrives, trimming the flexible
  // lines first so nobody opens the app already "in the red".
  const cap = income * 0.94
  let total = expenses.reduce((s, e) => s + e.amount, 0)
  if (income > 0 && total > cap) {
    const flexible = expenses.filter((e) => !e.essential)
    const flexTotal = flexible.reduce((s, e) => s + e.amount, 0)
    const overshoot = total - cap
    if (flexTotal > 0) {
      const factor = Math.max(0.3, (flexTotal - overshoot) / flexTotal)
      for (const e of flexible) e.amount = roundTo(e.amount * factor, 5)
    }
    total = expenses.reduce((s, e) => s + e.amount, 0)
  }

  const profile: Profile = {
    name: a.name,
    housing: a.housing,
    household: a.household,
    dependents: a.dependents,
    hasDebt: a.hasDebt,
    region: a.region,
  }

  return {
    version: 1,
    profile,
    income: [{ id: uid('inc'), name: 'Take-home pay', amount: income }],
    // Baselines are set after trimming, so each slider is scaled to the amount
    // the plan actually starts with.
    expenses: expenses.filter((e) => e.amount > 0).map((e) => ({ ...e, baseline: e.amount })),
    goals:
      a.hasDebt && a.debtBalance > 0
        ? [
            {
              id: uid('goal'),
              name: 'Pay off debt',
              kind: 'debt',
              target: 0,
              current: a.debtBalance,
              monthly: Math.max(a.debtPayment, 50),
              annualRate: 19.99,
            },
          ]
        : [],
    updatedAt: new Date().toISOString(),
    source: 'onboarding',
  }
}
