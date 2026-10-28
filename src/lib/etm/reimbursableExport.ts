import { includes, type Period } from './period'
import { bucketLabel, bucketOf, isReimbursable } from './tags'
import type { Account, Transaction } from './types'

/**
 * Reimbursable → Export: every reimbursable row in the period, on every
 * account (own accounts and USD included), one line per row — split parts
 * appear as their own lines. Amount is what was advanced, so a purchase is
 * positive and a refund negative.
 */

export const REIMBURSABLE_CSV_HEADER = [
  'Date',
  'Account',
  'Merchant',
  'Category',
  'Bucket',
  'Tags',
  'Amount',
  'Currency',
  'Paid from',
  'Reimbursement',
  'Notes',
  'Statement',
]

const cell = (value: string): string => {
  // A leading = + - @ would be read as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function reimbursableCsv(
  transactions: Transaction[],
  accounts: Account[],
  period: Period,
  reimbursableTag: string,
  reimbursedOn: Record<string, string> | undefined,
  /** The bucket's display name, when it has been renamed in its settings. */
  nameOf: (bucket: string) => string = (bucket) => bucket,
): { csv: string; count: number } {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const rows = transactions
    .filter((t) => !t.internal && includes(period, t.date) && isReimbursable(t, reimbursableTag))
    .sort((a, z) => a.date.localeCompare(z.date) || a.merchant.localeCompare(z.merchant))

  const lines = [REIMBURSABLE_CSV_HEADER.join(',')]
  for (const t of rows) {
    const account = byId.get(t.accountId)
    const own = account?.excludedFromBudget ?? false
    const day = reimbursedOn?.[t.date.slice(0, 7)]
    // Same rule as Settle up: only family-paid CAD advances are reimbursed by transfer.
    const reimbursement =
      own || t.currency !== 'CAD' || !day ? '' : t.date <= day ? `Covered ${day}` : 'Still to reimburse'
    const advanced = Math.round(-t.amount * 100) / 100
    lines.push(
      [
        t.date,
        account?.nickname ?? t.monarchAccount,
        t.merchant,
        t.category,
        nameOf(bucketLabel(bucketOf(t, reimbursableTag))),
        t.tags.join('; '),
        // Plain numbers, never through cell(): a refund's minus sign must stay a number.
        advanced.toFixed(2),
        t.currency,
        own ? 'Own account (not owed)' : 'Family account (owed back)',
        reimbursement,
        t.notes,
        t.originalStatement,
      ]
        .map((value, i) => (i === 6 ? value : cell(value)))
        .join(','),
    )
  }
  return { csv: lines.join('\r\n') + '\r\n', count: rows.length }
}

export const reimbursableFileName = (period: Period): string =>
  `tidewater-reimbursable-${period.start}-to-${period.end}.csv`
