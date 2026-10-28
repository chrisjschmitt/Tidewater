import { bucketLabel, bucketOf, isReimbursable } from './tags'
import type { Account, Transaction } from './types'

/**
 * Settling up a month's reimbursable advances: who is owed what, by the
 * account that paid, and what was charged to the holder's own accounts.
 *
 * - Paid from an account that counts in the family budget → owed back to it.
 * - Paid from an account kept out of the family budget (a personal card or
 *   account) → nobody is owed it: a card's share is what to pay on that card,
 *   a bank account's share is already paid.
 *
 * Reimbursements are made a few days before month end. With that day
 * recorded, advances up to it are covered and later ones are still to
 * reimburse; whatever was still open after last month's day carries in.
 */

export interface SettleRow {
  transaction: Transaction
  bucket: string
  /** 'covered' by this month's reimbursement, 'open' (after it, or none recorded), or 'carried' from last month. */
  state: 'covered' | 'open' | 'carried'
}

export interface AccountLine {
  account: Account
  amount: number
  count: number
}

export interface SettleUp {
  month: string
  reimbursedOn?: string
  /** Family-paid advances still to reimburse (open + carried), by paying account, largest first. */
  owedByAccount: AccountLine[]
  /** Family-paid advances already covered by this month's reimbursement, by paying account. */
  coveredByAccount: AccountLine[]
  /** Advances on accounts kept out of the budget, by account. */
  ownByAccount: AccountLine[]
  owedRows: SettleRow[]
  ownRows: SettleRow[]
}

const previousMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`
}

/** CAD only, like the budget comparison: USD advances stay on the bucket lists. */
export function settleUp(
  transactions: Transaction[],
  accounts: Account[],
  month: string,
  reimbursedOn: Record<string, string> | undefined,
  reimbursableTag: string,
): SettleUp {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const excluded = new Set(accounts.filter((a) => a.excludedFromBudget).map((a) => a.id))
  const day = reimbursedOn?.[month]
  const previous = previousMonth(month)
  const previousDay = reimbursedOn?.[previous]

  const owedRows: SettleRow[] = []
  const ownRows: SettleRow[] = []
  for (const t of transactions) {
    if (t.internal || t.currency !== 'CAD' || !isReimbursable(t, reimbursableTag)) continue
    const inMonth = t.date.slice(0, 7) === month
    const carried = !inMonth && t.date.slice(0, 7) === previous && previousDay !== undefined && t.date > previousDay
    if (!inMonth && !carried) continue
    const row: SettleRow = {
      transaction: t,
      bucket: bucketLabel(bucketOf(t, reimbursableTag)),
      state: carried ? 'carried' : day && t.date <= day ? 'covered' : 'open',
    }
    if (excluded.has(t.accountId)) {
      // Own accounts are settled on their own statement: only this month counts.
      if (!carried) ownRows.push(row)
    } else {
      owedRows.push(row)
    }
  }

  const tally = (rows: SettleRow[]): AccountLine[] => {
    const lines = new Map<string, AccountLine>()
    for (const { transaction } of rows) {
      const account = byId.get(transaction.accountId)
      if (!account) continue
      const line = lines.get(account.id) ?? { account, amount: 0, count: 0 }
      line.amount = Math.round((line.amount - transaction.amount) * 100) / 100
      line.count++
      lines.set(account.id, line)
    }
    return [...lines.values()].filter((l) => l.amount !== 0).sort((a, z) => z.amount - a.amount)
  }

  return {
    month,
    ...(day ? { reimbursedOn: day } : {}),
    owedByAccount: tally(owedRows.filter((r) => r.state !== 'covered')),
    coveredByAccount: tally(owedRows.filter((r) => r.state === 'covered')),
    ownByAccount: tally(ownRows),
    owedRows,
    ownRows,
  }
}
