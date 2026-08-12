import { groupForCategory, isInternalCategory } from '../categories'
import { uid } from '../format'
import type { Account, Transaction } from './types'

/**
 * Cash spending, which no export contains. Manual rows carry a generated id
 * rather than a content hash, so an import can never claim one of them.
 */
export interface ManualEntry {
  date: string
  merchant: string
  category: string
  /** Positive figure; `spend` decides the sign. */
  amount: number
  spend: boolean
  notes: string
  tags: string[]
  owner: string
}

export function createManualTransaction(entry: ManualEntry, account: Account): Transaction {
  const amount = Math.abs(entry.amount) * (entry.spend ? -1 : 1)
  const category = entry.category.trim() || 'Uncategorized'

  return {
    id: uid('manual'),
    date: entry.date,
    merchant: entry.merchant.trim(),
    originalStatement: '',
    notes: entry.notes.trim(),
    amount,
    currency: account.currency,
    accountId: account.id,
    monarchAccount: '',
    category,
    groupId: groupForCategory(category),
    internal: isInternalCategory(category),
    tags: entry.tags,
    owner: entry.owner.trim(),
    reviewed: true,
    source: 'manual',
    importBatchId: '',
  }
}
