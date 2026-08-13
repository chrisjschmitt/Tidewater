import { GROUPS, GROUP_BY_ID, looksLikeIncome } from '../categories'
import type { Budget, Group, GroupId } from '../types'
import { DEFAULT_CONFIG } from './config'
import { includes, monthsInPeriod, type Period } from './period'
import type { Currency, Money, Transaction } from './types'

export type { Money }

/**
 * All aggregation, as pure functions of (transactions, period, filters).
 * A few thousand rows is small enough to total in memory every render, so
 * there is no index to keep in step with the data.
 */

export const zeroMoney = (): Money => ({ CAD: 0, USD: 0 })

export const addTo = (money: Money, currency: Currency, amount: number): void => {
  money[currency] += amount
}

export const negate = (money: Money): Money => ({ CAD: -money.CAD, USD: -money.USD })

export const isEmpty = (money: Money): boolean => money.CAD === 0 && money.USD === 0

/** Only the currencies actually present, so a CAD-only view shows one figure. */
export const presentIn = (money: Money): Array<[Currency, number]> =>
  (Object.keys(money) as Currency[]).filter((c) => money[c] !== 0).map((c) => [c, money[c]])

export interface CategoryActual {
  /** Case-folded, for matching. */
  key: string
  /** The spelling the export used most often. */
  label: string
  groupId: GroupId
  /** Signed net: negative is spending. */
  net: Money
  /** Positive magnitude of spending, so a refund-heavy category can go negative. */
  spend: Money
  isIncome: boolean
  count: number
}

export interface GroupActual {
  groupId: GroupId
  spend: Money
  categories: CategoryActual[]
}

/** Reimbursable spending gathered under the tags that say who it is for. */
export interface ReimbursableBucket {
  /** The other tags, joined — or "No bucket" when there are none. */
  label: string
  tags: string[]
  spend: Money
  count: number
}

export interface ReimbursableTotals {
  spend: Money
  count: number
  buckets: ReimbursableBucket[]
}

export interface PeriodActuals {
  period: Period
  /** Calendar months touched — what a monthly plan is multiplied by. */
  months: number
  income: Money
  /** Family-budget spending: excludes internal movements and reimbursables. */
  spend: Money
  byGroup: Map<GroupId, GroupActual>
  categories: CategoryActual[]
  counted: number
  /** Transfers and card payments, kept but excluded from the totals above. */
  internal: number
  /** Advances repaid at month end, held apart from the budget (§5). */
  reimbursable: ReimbursableTotals
  /** The tie-out: budget spending plus reimbursable spending. */
  totalOut: Money
}

export interface AggregateOptions {
  /** Accounts marked as kept out of the family budget. */
  excludeAccountIds?: Set<string>
  /** Defaults to "Reimbursable"; the user may call it something else. */
  reimbursableTag?: string
}

export const NO_BUCKET = 'No bucket'

/** Matched case- and space-insensitively, like every other name in here. */
export const isReimbursable = (transaction: Transaction, tag: string): boolean => {
  const wanted = normalize(tag)
  return transaction.tags.some((t) => normalize(t) === wanted)
}

/**
 * A row's bucket is whatever else it is tagged with. Several tags are joined
 * into one bucket rather than counted under each, so the buckets always sum
 * to the reimbursable total and the tie-out holds.
 */
export function bucketOf(transaction: Transaction, tag: string): string[] {
  const wanted = normalize(tag)
  return transaction.tags
    .filter((t) => normalize(t) !== wanted && t.trim() !== '')
    .sort((a, z) => a.localeCompare(z))
}

export const bucketLabel = (tags: string[]): string =>
  tags.length === 0 ? NO_BUCKET : tags.join(' + ')

/**
 * Categories are netted before being classified, so a refund lands back on the
 * category it came from rather than reading as income — the same treatment the
 * budget importer already gives them.
 */
export function aggregate(
  transactions: Transaction[],
  period: Period,
  options: AggregateOptions = {},
): PeriodActuals {
  const excluded = options.excludeAccountIds ?? new Set<string>()
  const reimbursableTag = options.reimbursableTag ?? DEFAULT_CONFIG.reimbursableTag
  const buckets = new Map<string, CategoryActual & { spellings: Map<string, number> }>()
  const claimed = new Map<string, ReimbursableBucket>()
  const reimbursable: ReimbursableTotals = { spend: zeroMoney(), count: 0, buckets: [] }
  let counted = 0
  let internal = 0

  for (const transaction of transactions) {
    if (!includes(period, transaction.date)) continue
    if (transaction.internal) {
      internal++
      continue
    }

    // Held apart before anything else sees it, so an advance cannot net
    // against the category it was charged to. This runs ahead of the excluded
    // accounts on purpose: an account kept out of the family budget is
    // typically a personal card tracked *for* reimbursement, so dropping its
    // advances here would empty the very view they exist for.
    if (isReimbursable(transaction, reimbursableTag)) {
      const tags = bucketOf(transaction, reimbursableTag)
      const label = bucketLabel(tags)
      const bucket = claimed.get(label) ?? { label, tags, spend: zeroMoney(), count: 0 }
      addTo(bucket.spend, transaction.currency, -transaction.amount)
      bucket.count++
      claimed.set(label, bucket)
      addTo(reimbursable.spend, transaction.currency, -transaction.amount)
      reimbursable.count++
      continue
    }

    if (excluded.has(transaction.accountId)) continue

    counted++

    const key = transaction.category.trim().toLowerCase()
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: transaction.category,
        groupId: transaction.groupId,
        net: zeroMoney(),
        spend: zeroMoney(),
        isIncome: false,
        count: 0,
        spellings: new Map(),
      }
      buckets.set(key, bucket)
    }
    addTo(bucket.net, transaction.currency, transaction.amount)
    bucket.count++
    bucket.spellings.set(transaction.category, (bucket.spellings.get(transaction.category) ?? 0) + 1)
  }

  const income = zeroMoney()
  const spend = zeroMoney()
  const byGroup = new Map<GroupId, GroupActual>()
  const categories: CategoryActual[] = []

  for (const bucket of buckets.values()) {
    const label = commonest(bucket.spellings)
    const isIncome = looksLikeIncome(label)
    const category: CategoryActual = {
      key: bucket.key,
      label,
      groupId: bucket.groupId,
      net: bucket.net,
      spend: negate(bucket.net),
      isIncome,
      count: bucket.count,
    }
    categories.push(category)

    if (isIncome) {
      for (const [currency, value] of presentIn(bucket.net)) addTo(income, currency, value)
      continue
    }
    for (const [currency, value] of presentIn(category.spend)) addTo(spend, currency, value)

    const group = byGroup.get(bucket.groupId) ?? {
      groupId: bucket.groupId,
      spend: zeroMoney(),
      categories: [],
    }
    for (const [currency, value] of presentIn(category.spend)) addTo(group.spend, currency, value)
    group.categories.push(category)
    byGroup.set(bucket.groupId, group)
  }

  for (const group of byGroup.values()) group.categories.sort(bySpendDescending)
  categories.sort(bySpendDescending)

  // "No bucket" last: it is a prompt to tag something, not a bucket.
  reimbursable.buckets = [...claimed.values()].sort(
    (a, z) =>
      Number(a.label === NO_BUCKET) - Number(z.label === NO_BUCKET) ||
      z.spend.CAD - a.spend.CAD ||
      z.spend.USD - a.spend.USD,
  )

  const totalOut = zeroMoney()
  for (const [currency, value] of presentIn(spend)) addTo(totalOut, currency, value)
  for (const [currency, value] of presentIn(reimbursable.spend)) addTo(totalOut, currency, value)

  return {
    period,
    months: monthsInPeriod(period),
    income,
    spend,
    byGroup,
    categories,
    counted,
    internal,
    reimbursable,
    totalOut,
  }
}

/** One category's spending, flattened for the dashboard's drill-in. */
export interface CategorySpend {
  name: string
  spend: Money
  count: number
}

/**
 * The narrow slice of the aggregate the main-bundle dashboard is handed:
 * finished numbers only, so no ETM code has to be reachable from it.
 */
export interface DashboardActuals {
  label: string
  months: number
  income: Money
  /** Budget spending only. Reimbursables are named separately below. */
  spend: Money
  /** Held out of every figure here, so the dashboard can say so plainly. */
  reimbursable: Money
  byGroup: Map<GroupId, Money>
  /** What each group was made of, so a group can be opened without the module. */
  categoriesByGroup: Map<GroupId, CategorySpend[]>
}

export const dashboardActuals = (actuals: PeriodActuals, label: string): DashboardActuals => ({
  label,
  months: actuals.months,
  income: actuals.income,
  spend: actuals.spend,
  reimbursable: actuals.reimbursable.spend,
  byGroup: new Map([...actuals.byGroup].map(([id, group]) => [id, group.spend])),
  categoriesByGroup: new Map(
    [...actuals.byGroup].map(([id, group]) => [
      id,
      group.categories.map((c) => ({ name: c.label, spend: c.spend, count: c.count })),
    ]),
  ),
})

// --- budget comparison -----------------------------------------------------

export type ComparisonStatus = 'both' | 'planned-only' | 'unplanned'

export interface CategoryComparison {
  name: string
  /** CAD, already multiplied by the months in the period. */
  planned: number
  actual: Money
  count: number
  status: ComparisonStatus
}

export interface GroupComparison {
  group: Group
  planned: number
  actual: Money
  categories: CategoryComparison[]
}

export interface BudgetComparison {
  months: number
  plannedTotal: number
  actualTotal: Money
  groups: GroupComparison[]
}

/**
 * Plan lines and Monarch categories are independent free text, so they are
 * paired on their names, ignoring case and spacing. Anything that fails to
 * pair still appears — planned but unspent on one side, spent but unplanned on
 * the other — because a comparison that hides a difference is worse than none.
 *
 * Only CAD is compared against the plan; the USD figure rides alongside it,
 * never added in.
 */
export function compareToBudget(budget: Budget, actuals: PeriodActuals): BudgetComparison {
  const months = actuals.months
  const planned = new Map<string, { name: string; groupId: GroupId; amount: number }>()

  for (const line of budget.expenses) {
    const key = normalize(line.name)
    const found = planned.get(key)
    if (found) found.amount += line.amount * months
    else planned.set(key, { name: line.name, groupId: line.groupId, amount: line.amount * months })
  }

  const spent = new Map<string, CategoryActual>()
  for (const category of actuals.categories) {
    if (!category.isIncome) spent.set(normalize(category.label), category)
  }

  const groups = new Map<GroupId, GroupComparison>()
  const groupFor = (id: GroupId): GroupComparison => {
    const found = groups.get(id)
    if (found) return found
    const created: GroupComparison = {
      group: GROUP_BY_ID[id] ?? GROUP_BY_ID.other,
      planned: 0,
      actual: zeroMoney(),
      categories: [],
    }
    groups.set(id, created)
    return created
  }

  for (const [key, line] of planned) {
    const actual = spent.get(key)
    // A plan line decides where the pair is filed: it is the user's own view
    // of where the money belongs.
    const group = groupFor(line.groupId)
    const row: CategoryComparison = {
      name: line.name,
      planned: line.amount,
      actual: actual ? actual.spend : zeroMoney(),
      count: actual?.count ?? 0,
      status: actual ? 'both' : 'planned-only',
    }
    group.planned += row.planned
    for (const [currency, value] of presentIn(row.actual)) addTo(group.actual, currency, value)
    group.categories.push(row)
  }

  for (const [key, category] of spent) {
    if (planned.has(key)) continue
    const group = groupFor(category.groupId)
    const row: CategoryComparison = {
      name: category.label,
      planned: 0,
      actual: category.spend,
      count: category.count,
      status: 'unplanned',
    }
    for (const [currency, value] of presentIn(row.actual)) addTo(group.actual, currency, value)
    group.categories.push(row)
  }

  const ordered = GROUPS.map((group) => groups.get(group.id)).filter(
    (g): g is GroupComparison => g !== undefined && (g.planned > 0 || !isEmpty(g.actual)),
  )
  for (const group of ordered) {
    group.categories.sort((a, z) => z.actual.CAD - a.actual.CAD || z.planned - a.planned)
  }
  ordered.sort((a, z) => z.planned - a.planned || z.actual.CAD - a.actual.CAD)

  const actualTotal = zeroMoney()
  for (const group of ordered) {
    for (const [currency, value] of presentIn(group.actual)) addTo(actualTotal, currency, value)
  }

  return {
    months,
    plannedTotal: ordered.reduce((sum, g) => sum + g.planned, 0),
    actualTotal,
    groups: ordered,
  }
}

// --- filtering (the transactions view) -------------------------------------

export interface TransactionFilters {
  accountIds: string[]
  groupIds: GroupId[]
  categories: string[]
  tags: string[]
  owners: string[]
  minAmount: number | null
  maxAmount: number | null
  /** Matched against merchant, original statement and notes. */
  text: string
  includeInternal: boolean
}

export const noFilters = (): TransactionFilters => ({
  accountIds: [],
  groupIds: [],
  categories: [],
  tags: [],
  owners: [],
  minAmount: null,
  maxAmount: null,
  text: '',
  includeInternal: false,
})

export function filterTransactions(
  transactions: Transaction[],
  period: Period,
  filters: TransactionFilters,
): Transaction[] {
  const text = filters.text.trim().toLowerCase()
  const categories = new Set(filters.categories.map(normalize))

  return transactions.filter((t) => {
    if (!includes(period, t.date)) return false
    if (t.internal && !filters.includeInternal) return false
    if (filters.accountIds.length > 0 && !filters.accountIds.includes(t.accountId)) return false
    if (filters.groupIds.length > 0 && !filters.groupIds.includes(t.groupId)) return false
    if (categories.size > 0 && !categories.has(normalize(t.category))) return false
    if (filters.owners.length > 0 && !filters.owners.includes(t.owner)) return false
    if (filters.tags.length > 0 && !filters.tags.some((tag) => t.tags.includes(tag))) return false

    const size = Math.abs(t.amount)
    if (filters.minAmount !== null && size < filters.minAmount) return false
    if (filters.maxAmount !== null && size > filters.maxAmount) return false

    if (text) {
      const haystack = `${t.merchant} ${t.originalStatement} ${t.notes} ${t.category}`.toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })
}

/** Running totals for a list already in display order. */
export function runningTotals(transactions: Transaction[]): Money[] {
  const running = zeroMoney()
  return transactions.map((t) => {
    addTo(running, t.currency, t.amount)
    return { ...running }
  })
}

export function sumOf(transactions: Transaction[]): Money {
  const total = zeroMoney()
  for (const t of transactions) addTo(total, t.currency, t.amount)
  return total
}

const bySpendDescending = (a: CategoryActual, z: CategoryActual) =>
  z.spend.CAD - a.spend.CAD || z.spend.USD - a.spend.USD

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

function commonest(spellings: Map<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [label, count] of spellings) {
    if (count > bestCount) {
      best = label
      bestCount = count
    }
  }
  return best
}
