import { isInternalCategory } from '../categories'
import type { GroupId } from '../types'
import type { TdCutover } from './config'
import { etmGroupFor } from './groups'
import type { Transaction } from './types'

/**
 * Which rows count. Two feeds can hold the same purchase — Monarch's export
 * and TD's own file — so exactly one of them is the ledger for any account on
 * any day:
 *
 * - before the account's TD cutover date, Monarch (and manual entries) count
 *   and TD rows are a shadow, kept for comparison only;
 * - from the cutover date, TD (and manual entries) count and Monarch rows
 *   become the comparison.
 *
 * With no cutover set anywhere, TD rows never count. The cutover is
 * configuration only, so moving it moves no data and can be undone.
 */
export function cutoverFor(cutover: TdCutover | undefined, accountId: string): string | undefined {
  return cutover?.perAccount[accountId] ?? cutover?.global
}

export function counts(row: Transaction, cutover: TdCutover | undefined): boolean {
  if (row.source === 'manual') return true
  const from = cutoverFor(cutover, row.accountId)
  if (row.source === 'td') return Boolean(from && row.date >= from)
  return !from || row.date < from
}

/**
 * The ledger: rows that count, with split rows replaced by their parts so a
 * split is never counted twice. Each part keeps the parent's identity fields
 * and gets a derived id (`<id>#1`, `<id>#2`, …).
 */
export function ledgerView(
  all: Transaction[],
  cutover: TdCutover | undefined,
  groups?: Record<string, GroupId>,
): Transaction[] {
  const out: Transaction[] = []
  for (const row of all) {
    if (!counts(row, cutover)) continue
    if (!row.split || row.split.length === 0) {
      out.push(row)
      continue
    }
    row.split.forEach((line, index) => {
      out.push({
        ...row,
        id: `${row.id}#${index + 1}`,
        amount: line.amount,
        category: line.category,
        groupId: etmGroupFor(line.category, groups),
        internal: isInternalCategory(line.category),
        tags: line.tags,
        merchant: line.merchant ?? row.merchant,
        split: undefined,
      })
    })
  }
  return out
}

/** Rows kept for comparison only: the feed that does not count for its date. */
export function shadowRows(all: Transaction[], cutover: TdCutover | undefined): Transaction[] {
  return all.filter((row) => row.source !== 'manual' && !counts(row, cutover))
}
