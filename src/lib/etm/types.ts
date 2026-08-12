import type { GroupId } from '../types'

export type AccountKind = 'chequing' | 'savings' | 'credit'

/** Tracked natively, never converted (§7 of the architecture). */
export type Currency = 'CAD' | 'USD'

export const CURRENCIES: Currency[] = ['CAD', 'USD']

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  chequing: 'Chequing',
  savings: 'Savings',
  credit: 'Credit card',
}

/**
 * A registry the user builds by hand, because what an account *means* is
 * personal. Tidewater never invents these from a statement.
 */
export interface Account {
  id: string
  /** The user's own words for it. */
  nickname: string
  kind: AccountKind
  currency: Currency
  /** Display only. Full numbers are never entered or stored. */
  lastFour?: string
  /** The account string as it appears in Monarch exports, used for matching. */
  monarchName: string
  /** Pays for everything; the anchor of the monthly savings calculation. */
  funding: boolean
  /** Where a monthly surplus is transferred. */
  savingsDestination: boolean
  /** Tracked for reimbursement only, kept out of the family budget. */
  excludedFromBudget: boolean
  /** Minimum balance left in the account, used by the savings formula. */
  float?: number
}

export type TransactionSource = 'monarch' | 'manual'

/** One row of a Monarch export, or one manually entered cash purchase. */
export interface Transaction {
  /** Content hash of the row plus an occurrence index. See identity.ts. */
  id: string
  date: string
  merchant: string
  originalStatement: string
  notes: string
  /** Signed; negative is spending. Used exactly as Monarch exported it. */
  amount: number
  currency: Currency
  accountId: string
  /** The raw Monarch account string, kept so re-imports can still be traced. */
  monarchAccount: string
  /** The Monarch subcategory, verbatim — Tidewater never renames a category. */
  category: string
  groupId: GroupId
  /**
   * Transfers, card payments and balance adjustments. Excluded from income and
   * spend totals, but still visible in account and reconciliation views.
   */
  internal: boolean
  tags: string[]
  owner: string
  reviewed: boolean
  source: TransactionSource
  importBatchId: string
  /**
   * Reserved for a future direct aggregator feed (§9.1), which supplies stable
   * ids of its own and would need to dedup against these CSV-imported rows.
   */
  externalId?: string
}

/** One import, kept so it can be reviewed and undone. */
export interface ImportBatch {
  id: string
  fileName: string
  importedAt: string
  firstDate: string
  lastDate: string
  /** Month chunks the batch wrote to, so undo knows where to look. */
  months: string[]
  addedIds: string[]
  /**
   * Full previous versions of the rows this import overwrote. Undo is only
   * honest if it can put back what a re-import replaced.
   */
  replaced: Transaction[]
  rowsRead: number
  unchanged: number
}

export const monthOf = (date: string): string => date.slice(0, 7)
