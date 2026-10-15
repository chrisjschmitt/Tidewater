export type GroupId =
  | 'home'
  | 'food'
  | 'transport'
  | 'health'
  | 'personal'
  | 'joy'
  | 'family'
  | 'financial'
  | 'future'
  | 'other'

export interface Group {
  id: GroupId
  name: string
  blurb: string
  color: string
  soft: string
}

/**
 * A line paid every two weeks rather than monthly — a biweekly payroll, an
 * allowance paid every other Thursday, an accelerated mortgage. `perPayment`
 * goes out (or comes in) on each payday, counted forwards and backwards from
 * `firstPayday`. Most months have two paydays and two a year have three, so
 * the line's `amount` holds the monthly average (26 paydays ÷ 12), and a
 * single month's figure comes from counting its paydays.
 */
export interface EveryTwoWeeks {
  perPayment: number
  /** Any payday, `YYYY-MM-DD`. */
  firstPayday: string
}

export interface ExpenseLine {
  id: string
  name: string
  groupId: GroupId
  /** Planned monthly amount, always a positive number. Paid every two weeks: the monthly average. */
  amount: number
  everyTwoWeeks?: EveryTwoWeeks
  /** What the imported data suggested, kept so we can show "you planned X, you spend Y". */
  observed?: number
  /**
   * The amount this line started at. The slider builds its range from this
   * rather than from `amount`, so the track holds still while you adjust it
   * and reads the same the next time you open the group.
   */
  baseline?: number
  essential: boolean
}

export interface IncomeLine {
  id: string
  name: string
  /** Monthly amount. Paid every two weeks: the monthly average. */
  amount: number
  everyTwoWeeks?: EveryTwoWeeks
}

export type GoalKind = 'savings' | 'debt'

export interface Goal {
  id: string
  name: string
  kind: GoalKind
  /** Target amount for savings goals; original balance is `current` for debts. */
  target: number
  current: number
  monthly: number
  /** Annual rate as a percentage, e.g. 3.5 for a HISA or 19.99 for a card. */
  annualRate: number
  /** Chart window in months. Each goal keeps its own so cards can differ. */
  horizonMonths?: number
}

export type Housing = 'rent' | 'own' | 'other'
export type Household = 'single' | 'partnered'

export interface Profile {
  name: string
  housing: Housing
  household: Household
  dependents: number
  hasDebt: boolean
  region: string
}

export interface Budget {
  version: 1
  profile: Profile
  income: IncomeLine[]
  expenses: ExpenseLine[]
  goals: Goal[]
  /** ISO timestamp of the last change, shown in the data menu. */
  updatedAt: string
  /** Where the numbers came from, so the dashboard can explain itself. */
  source: 'onboarding' | 'sample' | 'budget-csv' | 'transactions'
  /** Set when derived from transactions, e.g. "12 months ending Jul 2026". */
  sourceNote?: string
}
