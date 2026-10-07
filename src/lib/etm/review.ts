import { isInternalCategory, looksLikeIncome } from '../categories'
import type { GroupId } from '../types'
import { etmGroupFor } from './groups'
import { isReimbursable } from './tags'
import type { Account, SplitLine, Transaction } from './types'

/**
 * A row as the user settled it: confirmed, with merchant, comment, category,
 * tags and any split decided together. The largest line names the row; a
 * single line clears any split.
 */
export function settleRow(
  row: Transaction,
  change: { merchant: string; notes?: string; lines: SplitLine[] },
  groups?: Record<string, GroupId>,
): Transaction {
  const main = [...change.lines].sort((a, z) => Math.abs(z.amount) - Math.abs(a.amount))[0]!
  const next: Transaction = {
    ...row,
    merchant: change.merchant,
    notes: change.notes ?? row.notes,
    category: main.category,
    groupId: etmGroupFor(main.category, groups),
    internal: isInternalCategory(main.category),
    tags: main.tags,
    reviewed: true,
    ...(row.source === 'td'
      ? {
          prediction: {
            layer: 'manual' as const,
            confidence: 'high' as const,
            reviewReasons: [],
            ...(row.prediction?.suggestions ? { suggestions: row.prediction.suggestions } : {}),
          },
        }
      : {}),
  }
  if (change.lines.length > 1) next.split = change.lines
  else delete next.split
  return next
}

/**
 * Whether a ledger row counts toward the Budget tab's “spent”: the same rule
 * aggregate() applies — not a transfer or card payment, not held apart as
 * reimbursable, not on an account kept out of the budget, not income.
 */
export function countsAsBudgetSpend(row: Transaction, reimbursableTag: string, accounts: Account[]): boolean {
  if (row.internal) return false
  if (isReimbursable(row, reimbursableTag)) return false
  if (accounts.find((a) => a.id === row.accountId)?.excludedFromBudget) return false
  return !looksLikeIncome(row.category)
}
