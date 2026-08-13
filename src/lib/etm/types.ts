import type { GroupId } from '../types'

export type AccountKind = 'chequing' | 'savings' | 'credit'

/** Tracked natively, never converted (§7 of the architecture). */
export type Currency = 'CAD' | 'USD'

export const CURRENCIES: Currency[] = ['CAD', 'USD']

/**
 * A total held per currency. The two are never added together (§7), so every
 * figure in the module carries both and shows whichever is present.
 */
export type Money = Record<Currency, number>

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
  /** Holds the cash the month is settled from, and carries the float. */
  funding: boolean
  /**
   * A card everyday purchases go on, cleared each month. What is owed on it
   * is subtracted from the funding balance before anything is swept away.
   * More than one may be marked; they are summed per currency.
   */
  mainCard: boolean
  /** Where a monthly surplus is transferred. */
  savingsDestination: boolean
  /** Tracked for reimbursement only, kept out of the family budget. */
  excludedFromBudget: boolean
  /** Minimum balance left in the account, used by the savings formula. */
  float?: number
}

/**
 * What an account held on one date — the anchor reconciliation measures
 * against. Statement CSVs supply these; they are never a second source of
 * transactions (§9).
 */
export interface BalanceSnapshot {
  id: string
  accountId: string
  date: string
  /**
   * On a card this is what is owed, entered positive. Nothing here is signed
   * by account kind: the reconciliation applies that, in one place.
   */
  balance: number
  /** Card charges that have not posted yet, and so appear in no export. */
  pending?: number
  source: 'manual' | 'statement'
  /** Set when a statement supplied it, for provenance. */
  fileName?: string
}

export type ReconciliationStatus = 'open' | 'reconciled'

/** One month's close, kept so a year can be reviewed without recomputing it. */
export interface ReconciliationRecord {
  /** The month itself, `YYYY-MM` — one record per month, so it is the id. */
  month: string
  status: ReconciliationStatus
  closedAt?: string
  /** The savings figure as it stood when the month was closed. */
  savings?: Money
  /** Reimbursement transfers the user recorded having asked for. */
  settled: SettledTransfer[]
  /** What the balances said, less what the rows said, at the close. */
  residual: Money
  notes: string
}

export interface SettledTransfer {
  bucket: string
  owedBy: string
  amount: number
  currency: Currency
  recordedAt: string
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
