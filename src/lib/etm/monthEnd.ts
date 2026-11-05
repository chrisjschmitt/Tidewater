import { bucketLabel, bucketOf, isReimbursable } from './tags'
import type { StepState } from './routine'
import type { Account, Currency, Transaction } from './types'

/**
 * Month end, the way it is done by hand in the reimbursements sheet: every
 * reimbursable row of the month, grouped by the account that paid it, then by
 * bucket, each with its sum — so each bucket can be checked ("no one wants to
 * reimburse anything they're not responsible for") before it is settled.
 */

export interface BucketGroup {
  bucket: string
  /** Display name (renamed in its settings), or the bucket itself. */
  name: string
  owedBy: string
  /** What was advanced: purchases positive, refunds negative. */
  total: number
  rows: Transaction[]
}

export interface AccountGroup {
  account: Account
  /** Kept out of the family budget: settled on its own statement, not owed back. */
  own: boolean
  currency: Currency
  total: number
  buckets: BucketGroup[]
}

export interface MonthReimbursements {
  accounts: AccountGroup[]
  /** CAD advanced from family accounts — the amount owed back. */
  owed: number
  /** CAD charged to own accounts. */
  own: number
  count: number
}

const cents = (n: number) => Math.round(n * 100) / 100

export function reimbursementsByAccount(
  transactions: Transaction[],
  accounts: Account[],
  month: string,
  reimbursableTag: string,
  nameOf: (bucket: string) => string = (b) => b,
  owedByOf: (bucket: string) => string = () => '',
): MonthReimbursements {
  const rows = transactions.filter(
    (t) => !t.internal && t.date.slice(0, 7) === month && isReimbursable(t, reimbursableTag),
  )
  const out: AccountGroup[] = []
  let owed = 0
  let own = 0
  // Accounts in the order they are kept; any unknown account last.
  const order = new Map(accounts.map((a, i) => [a.id, i]))
  const byAccount = new Map<string, Transaction[]>()
  for (const t of rows) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t])
  for (const [accountId, list] of [...byAccount].sort((a, z) => (order.get(a[0]) ?? 999) - (order.get(z[0]) ?? 999))) {
    const account = accounts.find((a) => a.id === accountId)
    if (!account) continue
    const buckets = new Map<string, Transaction[]>()
    for (const t of list) {
      const bucket = bucketLabel(bucketOf(t, reimbursableTag))
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), t])
    }
    const groups: BucketGroup[] = [...buckets]
      .map(([bucket, items]) => ({
        bucket,
        name: nameOf(bucket),
        owedBy: owedByOf(bucket),
        total: cents(items.reduce((s, t) => s - t.amount, 0)),
        rows: items.sort((a, z) => a.date.localeCompare(z.date) || a.merchant.localeCompare(z.merchant)),
      }))
      .sort((a, z) => a.name.localeCompare(z.name))
    const total = cents(groups.reduce((s, g) => s + g.total, 0))
    const isOwn = Boolean(account.excludedFromBudget)
    if (account.currency === 'CAD') {
      if (isOwn) own = cents(own + total)
      else owed = cents(owed + total)
    }
    out.push({ account, own: isOwn, currency: account.currency, total, buckets: groups })
  }
  return { accounts: out, owed, own, count: rows.length }
}

/** The key a bucket's "checked" tick is kept under, per month. */
export const checkKey = (accountId: string, bucket: string): string => `${accountId}|${bucket}`

export interface MonthEndInput {
  untidy: number
  reimbursements: MonthReimbursements
  /** Keys (checkKey) ticked as checked this month. */
  checked: string[]
  reimbursedOn?: string
  /** Every balance-anchored account has a closing balance for the month. */
  balancesIn: boolean
  balanced: boolean
  closed: boolean
  transferRecorded: boolean
  backup: StepState
}

export interface MonthEndSteps {
  tidy: StepState
  reimbursements: StepState
  settle: StepState
  balances: StepState
  close: StepState
  transfer: StepState
  backup: StepState
  needCount: number
}

export function monthEndSteps(input: MonthEndInput): MonthEndSteps {
  const tidy: StepState = input.untidy > 0 ? 'needs' : 'done'
  const groups = input.reimbursements.accounts.flatMap((a) => a.buckets.map((b) => checkKey(a.account.id, b.bucket)))
  const checked = new Set(input.checked)
  const reimbursements: StepState =
    groups.length === 0 ? 'notNeeded' : groups.every((key) => checked.has(key)) ? 'done' : 'needs'
  const anyOwed = input.reimbursements.accounts.some((a) => !a.own && a.total !== 0)
  const settle: StepState = !anyOwed ? 'notNeeded' : input.reimbursedOn ? 'done' : 'needs'
  const balances: StepState = input.balancesIn && input.balanced ? 'done' : 'needs'
  const close: StepState = input.closed ? 'done' : 'needs'
  const transfer: StepState = input.transferRecorded ? 'done' : 'needs'
  const steps = { tidy, reimbursements, settle, balances, close, transfer, backup: input.backup }
  return { ...steps, needCount: Object.values(steps).filter((s) => s === 'needs').length }
}

/**
 * A card's charges still pending at the end of a month, from the downloader's
 * reading: only a reading taken around the month end (three days before to a
 * week after) and only charges dated in or before the month — a pending
 * charge from the 2nd of the next month belongs to that month.
 */
export function pendingAtMonthEnd(
  snapshot: { date: string; accounts: Array<{ accountId: string; charges: Array<{ date: string; amount: number }> }> } | undefined,
  month: string,
): Map<string, number> {
  const out = new Map<string, number>()
  if (!snapshot) return out
  const [y, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  const days = (Date.parse(snapshot.date) - Date.parse(end)) / 86_400_000
  if (days < -3 || days > 7) return out
  for (const reading of snapshot.accounts) {
    const total = cents(reading.charges.filter((c) => c.date <= end).reduce((s, c) => s - c.amount, 0))
    if (total !== 0) out.set(reading.accountId, total)
  }
  return out
}

/**
 * What each card owed at the end of a month, from EasyWeb's current balance —
 * which, unlike the export, already counts a payment made before the month
 * ended but posted after it. Only a reading taken on the month's last day or
 * within a week after is used, and the card's own spending posted after the
 * month (up to the reading) is taken back out, so the figure is the month's.
 * Payments and transfers are left in: a payment that left the bank in the
 * month is exactly what this is here to count.
 */
export function cardOwedAtMonthEnd(
  snapshot:
    | { date: string; accounts: Array<{ accountId: string; currentBalance?: number }> }
    | undefined,
  month: string,
  transactions: Transaction[],
): Map<string, { owed: number; readOn: string }> {
  const out = new Map<string, { owed: number; readOn: string }>()
  if (!snapshot) return out
  const [y, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  const days = (Date.parse(snapshot.date) - Date.parse(end)) / 86_400_000
  if (days < 0 || days > 7) return out
  for (const reading of snapshot.accounts) {
    if (reading.currentBalance === undefined) continue
    const after = transactions.filter(
      (t) =>
        t.accountId === reading.accountId &&
        !t.pending &&
        !t.internal &&
        t.date > end &&
        t.date <= snapshot.date,
    )
    // Charges are negative: owed at month end = owed now less what was charged since.
    const owed = cents(reading.currentBalance + after.reduce((s, t) => s + t.amount, 0))
    out.set(reading.accountId, { owed, readOn: snapshot.date })
  }
  return out
}
