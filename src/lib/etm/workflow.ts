import { addTo, bucketLabel, bucketOf, isReimbursable, zeroMoney } from './aggregate'
import { isParentOnlyReimbursable } from './tags'
import { bucketName, owedBy, type EtmConfig } from './config'
import { includes, monthPeriod } from './period'
import type {
  Account,
  BalanceSnapshot,
  Currency,
  Money,
  Transaction,
} from './types'

/**
 * The monthly cycle's arithmetic, kept apart from the screen that shows it.
 *
 * Everything here is per currency (§7) and pure: given rows, balances and
 * configuration it returns figures, and never writes or moves anything. The
 * point of the workflow screen is to assist a judgment, so each figure is
 * returned with the parts it was built from rather than as a lone number.
 */

// --- monthly savings -------------------------------------------------------

export interface SavingsPart {
  accountId: string
  nickname: string
  currency: Currency
  /** Signed as it contributes: cash positive, float and card debt negative. */
  effect: number
  kind: 'balance' | 'float' | 'card' | 'pending'
  /** True when the figure is guessing, because no balance was ever given. */
  missing: boolean
  /** The date of the snapshot used, so a stale one is visible. */
  asOf?: string
}

export interface Savings {
  /** Cash, less the float, less what is owed. Negative means a top-up. */
  total: Money
  parts: SavingsPart[]
  /** Accounts whose role is set but whose balance was never entered. */
  missing: string[]
}

/**
 * Funding balance − float − what is owed on the cards − charges not yet
 * posted. Pending charges are asked for by hand because they appear in no
 * export, and a card cleared monthly is only truly cleared once they land.
 */
export function computeSavings(
  accounts: Account[],
  balances: BalanceSnapshot[],
  asOf: string,
): Savings {
  const total = zeroMoney()
  const parts: SavingsPart[] = []
  const missing: string[] = []

  const add = (part: SavingsPart) => {
    addTo(total, part.currency, part.effect)
    parts.push(part)
  }

  for (const account of accounts) {
    if (!account.funding && !account.mainCard) continue
    const snapshot = latestSnapshot(balances, account.id, asOf)
    if (!snapshot) missing.push(account.nickname)

    const base = {
      accountId: account.id,
      nickname: account.nickname,
      currency: account.currency,
      missing: !snapshot,
      asOf: snapshot?.date,
    }

    if (account.funding) {
      add({ ...base, kind: 'balance', effect: snapshot?.balance ?? 0 })
      if (account.float) add({ ...base, kind: 'float', effect: -account.float })
    }

    if (account.mainCard) {
      // A card balance is entered as what is owed, so it always subtracts.
      add({ ...base, kind: 'card', effect: -Math.abs(snapshot?.balance ?? 0) })
      if (snapshot?.pending) {
        add({ ...base, kind: 'pending', effect: -Math.abs(snapshot.pending) })
      }
    }
  }

  return { total, parts, missing }
}

/** The most recent balance for an account on or before a date. */
export function latestSnapshot(
  balances: BalanceSnapshot[],
  accountId: string,
  onOrBefore: string,
): BalanceSnapshot | undefined {
  let best: BalanceSnapshot | undefined
  for (const snapshot of balances) {
    if (snapshot.accountId !== accountId) continue
    if (snapshot.date > onOrBefore) continue
    if (!best || snapshot.date > best.date) best = snapshot
  }
  return best
}

// --- reimbursement pivot ---------------------------------------------------

export interface PivotRow {
  /** The derived bucket, which is also its key in configuration. */
  bucket: string
  /** What to call it on screen — the user's name for it, if they gave one. */
  label: string
  owedBy: string
  amount: number
  currency: Currency
  count: number
  transactionIds: string[]
  /** Already recorded as asked for, so it is not asked for twice. */
  settled: boolean
}

/**
 * The pivot built by hand in a spreadsheet today: reimbursables for the
 * month, grouped by bucket and split by currency, each expressed as an amount
 * to ask someone for. A bucket with no owner still appears — the money is
 * real whether or not the configuration has caught up.
 */
export function reimbursementPivot(
  transactions: Transaction[],
  month: string,
  config: EtmConfig,
  options: { settled?: Array<{ bucket: string; currency: Currency }> } = {},
): PivotRow[] {
  const period = monthPeriod(month)
  const rows = new Map<string, PivotRow>()

  // Deliberately blind to the excluded-from-budget flag: a card carrying
  // that flag is usually a personal one tracked precisely so its advances
  // can be claimed back here.
  for (const transaction of transactions) {
    if (transaction.internal) continue
    if (!includes(period, transaction.date)) continue
    if (!isReimbursable(transaction, config.reimbursableTag)) continue

    const bucket = bucketLabel(bucketOf(transaction, config.reimbursableTag))
    const key = `${bucket}\u0000${transaction.currency}`
    const row = rows.get(key) ?? {
      bucket,
      label: bucketName(config, bucket),
      owedBy: owedBy(config, bucket),
      amount: 0,
      currency: transaction.currency,
      count: 0,
      transactionIds: [],
      settled: false,
    }
    row.amount += -transaction.amount
    row.count++
    row.transactionIds.push(transaction.id)
    rows.set(key, row)
  }

  for (const row of rows.values()) {
    row.settled = (options.settled ?? []).some(
      (s) => s.bucket === row.bucket && s.currency === row.currency,
    )
  }

  return [...rows.values()].sort(
    (a, z) => z.amount - a.amount || a.bucket.localeCompare(z.bucket),
  )
}

// --- reconciliation --------------------------------------------------------

export interface AccountReconciliation {
  accountId: string
  nickname: string
  currency: Currency
  kind: Account['kind']
  /** Sum of every row on the account this month, transfers included. */
  flow: number
  opening?: BalanceSnapshot
  closing?: BalanceSnapshot
  /** Closing − opening, signed the way the rows are. */
  observed?: number
  /** Observed − flow. Zero means the rows explain the balance exactly. */
  residual?: number
  withinTolerance: boolean
  /** Both anchors present, so a comparison was possible at all. */
  anchored: boolean
  count: number
}

export interface Reconciliation {
  month: string
  accounts: AccountReconciliation[]
  /** Summed across anchored accounts only, per currency. */
  residual: Money
  /** Every anchored account agrees within tolerance. */
  balanced: boolean
  /** Named so the screen can say what is missing rather than stay silent. */
  notAnchored: string[]
  /** The rows most likely to explain a residual, largest first. */
  unexplained: Transaction[]
}

/**
 * Compares what the rows say happened against what the balances say happened,
 * per account. Internal transfers are included here, unlike everywhere else:
 * moving money between two accounts does not change spending, but it very
 * much changes a balance.
 *
 * A credit card is measured the same way once its sign is settled. Balances
 * on a card are entered as what is owed, so a month of spending makes that
 * number rise while the rows are negative; the balance change is negated to
 * put both in the same language before they are compared.
 */
export function reconcile(
  transactions: Transaction[],
  accounts: Account[],
  balances: BalanceSnapshot[],
  month: string,
  tolerance: number,
): Reconciliation {
  const period = monthPeriod(month)
  const flows = new Map<string, { sum: number; count: number }>()

  for (const transaction of transactions) {
    if (!includes(period, transaction.date)) continue
    const current = flows.get(transaction.accountId) ?? { sum: 0, count: 0 }
    current.sum += transaction.amount
    current.count++
    flows.set(transaction.accountId, current)
  }

  const results: AccountReconciliation[] = []
  const residual = zeroMoney()
  const notAnchored: string[] = []

  for (const account of accounts) {
    const flow = flows.get(account.id) ?? { sum: 0, count: 0 }
    const opening = openingFor(balances, account.id, month)
    const closing = closingFor(balances, account.id, month)

    const entry: AccountReconciliation = {
      accountId: account.id,
      nickname: account.nickname,
      currency: account.currency,
      kind: account.kind,
      flow: flow.sum,
      count: flow.count,
      opening,
      closing,
      anchored: Boolean(opening && closing),
      withinTolerance: true,
    }

    if (opening && closing) {
      const change = closing.balance - opening.balance
      entry.observed = account.kind === 'credit' ? -change : change
      entry.residual = entry.observed - flow.sum
      entry.withinTolerance = Math.abs(entry.residual) <= tolerance
      addTo(residual, account.currency, entry.residual)
    } else if (flow.count > 0 || opening || closing) {
      // Silence about an account with activity would be the worst outcome.
      notAnchored.push(account.nickname)
    }

    results.push(entry)
  }

  const off = new Set(
    results.filter((r) => r.anchored && !r.withinTolerance).map((r) => r.accountId),
  )
  const unexplained = transactions
    .filter((t) => includes(period, t.date) && off.has(t.accountId))
    .sort((a, z) => Math.abs(z.amount) - Math.abs(a.amount))
    .slice(0, 10)

  return {
    month,
    accounts: results,
    residual,
    balanced: results.every((r) => !r.anchored || r.withinTolerance),
    notAnchored,
    unexplained,
  }
}

/**
 * The month opens where the last one closed. Chaining means one balance an
 * account a month rather than two, and it makes a gap obvious: if no earlier
 * snapshot exists, the month simply is not anchored.
 */
export function openingFor(
  balances: BalanceSnapshot[],
  accountId: string,
  month: string,
): BalanceSnapshot | undefined {
  return latestSnapshot(balances, accountId, dayBefore(`${month}-01`))
}

export function closingFor(
  balances: BalanceSnapshot[],
  accountId: string,
  month: string,
): BalanceSnapshot | undefined {
  const { end } = monthPeriod(month)
  const within = balances.filter(
    (b) => b.accountId === accountId && b.date >= `${month}-01` && b.date <= end,
  )
  return within.sort((a, z) => z.date.localeCompare(a.date))[0]
}

/** ISO date arithmetic in strings, so no timezone can move a day (§5). */
export function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const previous = new Date(Date.UTC(y!, m! - 1, d! - 1))
  return previous.toISOString().slice(0, 10)
}

// --- the tidy step ---------------------------------------------------------

export interface Untidy {
  uncategorized: Transaction[]
  /** Spending on a card claims usually come from, but never tagged as owed. */
  untaggedCandidates: Transaction[]
  /** Still on the generic parent tag, with no `Parent: …` sub-tag. */
  parentOnly: Transaction[]
  unreviewed: number
}

/**
 * What the month is still missing. The candidates are the useful half: a
 * purchase on an account tracked only for reimbursement that carries no
 * reimbursable family tag (`Reimbursable` or `Reimbursable: …`) is either a
 * forgotten tag or a genuine personal expense, and only the user knows which.
 *
 * Which accounts those are is inferred rather than configured, because being
 * kept out of the family budget does not on its own mean claims happen there
 * — a separate business account is out of the budget too, and asking about a
 * missing tag on every one of its expenses would be noise forever. So an
 * account only qualifies once it has actually carried the tag at some point.
 * The cost is that the first claim on a brand-new card goes unflagged, which
 * is the better way to be wrong: the app should not presume.
 */
export function findUntidy(
  transactions: Transaction[],
  accounts: Account[],
  month: string,
  config: EtmConfig,
): Untidy {
  const period = monthPeriod(month)
  const hasClaimed = new Set(
    transactions
      .filter((t) => isReimbursable(t, config.reimbursableTag))
      .map((t) => t.accountId),
  )
  const forReimbursement = new Set(
    accounts.filter((a) => a.excludedFromBudget && hasClaimed.has(a.id)).map((a) => a.id),
  )
  const uncategorized: Transaction[] = []
  const untaggedCandidates: Transaction[] = []
  const parentOnly: Transaction[] = []
  let unreviewed = 0

  for (const transaction of transactions) {
    if (!includes(period, transaction.date)) continue
    if (transaction.internal) continue
    if (!transaction.category || /^uncategorized$/i.test(transaction.category)) {
      uncategorized.push(transaction)
    }
    if (
      forReimbursement.has(transaction.accountId) &&
      transaction.amount < 0 &&
      !isReimbursable(transaction, config.reimbursableTag)
    ) {
      untaggedCandidates.push(transaction)
    }
    if (isParentOnlyReimbursable(transaction.tags, config.reimbursableTag)) {
      parentOnly.push(transaction)
    }
    if (!transaction.reviewed) unreviewed++
  }

  return { uncategorized, untaggedCandidates, parentOnly, unreviewed }
}