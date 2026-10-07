import { isInternalCategory } from '../categories'
import { uid } from '../format'
import type { GroupId } from '../types'
import { etmGroupFor } from './groups'
import { occurrenceCounter, transactionId } from './identity'
import { parseMonarchCsv, type MonarchRow } from './monarch'
import { matchStatementFiles } from './statementFolder'
import { pseudoFileName, type TdAccountBlock, type TdFeedRow } from './td'
import { monthOf, type Account, type Prediction, type SplitLine, type Transaction } from './types'

/**
 * Turns parsed rows into transactions and works out what the store already
 * knows. Nothing here reads the CSV format or writes to storage, so the same
 * planning applies to any feed that can produce `MonarchRow`s.
 */

/** A Monarch account string with no match in the registry. */
export interface UnmatchedAccount {
  monarchName: string
  rows: number
  /** A merchant from one of its rows, to help the user recognise it. */
  sample: string
}

export interface ImportPlan {
  batchId: string
  fileName: string
  rowsRead: number
  skippedRows: number
  /** Rows the store has never seen. */
  added: Transaction[]
  /** Rows already stored whose editable fields changed in Monarch. */
  updated: Array<{ next: Transaction; previous: Transaction }>
  /** Rows already stored and identical — the ordinary case on a re-import. */
  unchanged: number
  unmatched: UnmatchedAccount[]
  internal: number
  firstDate: string
  lastDate: string
  months: string[]
}

/** Fields Monarch owns and may revise between exports. */
const MUTABLE: Array<keyof Transaction> = [
  'merchant',
  'notes',
  'category',
  'groupId',
  'owner',
  'reviewed',
  'accountId',
  'currency',
]

export function findUnmatchedAccounts(rows: MonarchRow[], accounts: Account[]): UnmatchedAccount[] {
  const known = accountIndex(accounts)
  const missing = new Map<string, UnmatchedAccount>()

  for (const row of rows) {
    if (!row.account || known.has(normalize(row.account))) continue
    const found = missing.get(row.account)
    if (found) found.rows++
    else missing.set(row.account, { monarchName: row.account, rows: 1, sample: row.merchant })
  }

  return [...missing.values()].sort((a, z) => z.rows - a.rows)
}

export async function planImport(
  text: string,
  options: {
    fileName: string
    accounts: Account[]
    existing: Map<string, Transaction>
    groups?: Record<string, GroupId>
  },
): Promise<ImportPlan> {
  const { rows, skipped } = parseMonarchCsv(text)
  const { fileName, accounts, existing } = options
  const known = accountIndex(accounts)
  const batchId = uid('batch')

  const plan: ImportPlan = {
    batchId,
    fileName,
    rowsRead: rows.length,
    skippedRows: skipped,
    added: [],
    updated: [],
    unchanged: 0,
    unmatched: findUnmatchedAccounts(rows, accounts),
    internal: 0,
    firstDate: '',
    lastDate: '',
    months: [],
  }

  const nextOccurrence = occurrenceCounter()
  const months = new Set<string>()

  for (const row of rows) {
    const account = known.get(normalize(row.account))
    // Rows whose account is unknown are left out entirely; the review screen
    // asks for those accounts to be created, then the plan is rebuilt.
    if (!account) continue

    const parts = {
      date: row.date,
      account: row.account,
      amount: row.amount,
      originalStatement: row.originalStatement || row.merchant,
    }
    const id = await transactionId(parts, nextOccurrence(parts))

    const next: Transaction = {
      id,
      date: row.date,
      merchant: row.merchant,
      originalStatement: row.originalStatement,
      notes: row.notes,
      amount: row.amount,
      currency: account.currency,
      accountId: account.id,
      monarchAccount: row.account,
      category: row.category,
      groupId: etmGroupFor(row.category, options.groups),
      internal: isInternalCategory(row.category),
      tags: row.tags,
      owner: row.owner,
      reviewed: row.reviewed,
      source: 'monarch',
      importBatchId: batchId,
    }

    if (next.internal) plan.internal++
    if (!plan.firstDate || row.date < plan.firstDate) plan.firstDate = row.date
    if (!plan.lastDate || row.date > plan.lastDate) plan.lastDate = row.date

    const previous = existing.get(id)
    if (!previous) {
      plan.added.push(next)
      months.add(monthOf(row.date))
      continue
    }

    // Manual entries are the user's own record of cash and are never revised
    // by an import, even in the unlikely event of an id collision.
    if (previous.source === 'manual' || !differs(previous, next)) {
      plan.unchanged++
      continue
    }

    plan.updated.push({ next: { ...next, externalId: previous.externalId }, previous })
    months.add(monthOf(row.date))
  }

  plan.months = [...months].sort()
  return plan
}

function differs(previous: Transaction, next: Transaction): boolean {
  if (MUTABLE.some((field) => previous[field] !== next[field])) return true
  return previous.tags.join('\u0000') !== next.tags.join('\u0000')
}

const normalize = (name: string) => name.trim().toLowerCase()

function accountIndex(accounts: Account[]): Map<string, Account> {
  const index = new Map<string, Account>()
  for (const account of accounts) {
    if (account.monarchName) index.set(normalize(account.monarchName), account)
  }
  return index
}

/** What the rules decide for one TD row; absent fields fall back to Uncategorized. */
export interface TdOutcome {
  merchant: string
  category: string
  tags: string[]
  split?: SplitLine[]
  prediction: Prediction
}

export type TdCategorizer = (row: TdFeedRow, account: Account) => TdOutcome

/** Before any rules exist: every row waits for review, named as TD wrote it. */
export const uncategorized: TdCategorizer = (row) => ({
  merchant: row.description,
  category: 'Uncategorized',
  tags: [],
  prediction: { layer: 'review', confidence: 'low', reviewReasons: ['No rule matched'] },
})

/**
 * The TD feed's plan. Accounts are matched the way the folder reader matches
 * files — last four first, then the label — so a combined file and the old
 * per-account files land on the same accounts.
 *
 * TD owns only the facts of a row: when, which account, how much, what the
 * bank wrote, and the running balance. Category, tags, split and merchant
 * belong to the rules and to the user, so a row already stored is never
 * revised by a later download, however its prediction would come out now.
 */
export async function planTdImport(
  blocks: TdAccountBlock[],
  options: {
    fileName: string
    fileDate: string
    accounts: Account[]
    existing: Map<string, Transaction>
    groups?: Record<string, GroupId>
    categorize?: TdCategorizer
  },
): Promise<ImportPlan & { unmatchedBlocks: TdAccountBlock[] }> {
  const { fileName, fileDate, accounts, existing } = options
  const categorize = options.categorize ?? uncategorized
  const batchId = uid('batch')
  const names = blocks.map((block) => pseudoFileName(block, fileDate))
  const match = matchStatementFiles(accounts, names)
  const accountFor = new Map<string, Account>()
  for (const [accountId, file] of match.byAccount) {
    const account = accounts.find((a) => a.id === accountId)
    if (account) accountFor.set(file.name, account)
  }

  const plan: ImportPlan & { unmatchedBlocks: TdAccountBlock[] } = {
    batchId,
    fileName,
    rowsRead: blocks.reduce((sum, block) => sum + block.rows.length, 0),
    skippedRows: 0,
    added: [],
    updated: [],
    unchanged: 0,
    unmatched: [],
    unmatchedBlocks: [],
    internal: 0,
    firstDate: '',
    lastDate: '',
    months: [],
  }
  const months = new Set<string>()

  for (const [index, block] of blocks.entries()) {
    const account = accountFor.get(names[index]!)
    if (!account) {
      plan.unmatchedBlocks.push(block)
      plan.unmatched.push({ monarchName: `${block.account} (…${block.lastFour})`, rows: block.rows.length, sample: block.rows[0]?.description ?? '' })
      continue
    }
    // Counted per account within the file, in TD's own order, so the same
    // download read twice — or an overlapping one — gives the same ids.
    const nextOccurrence = occurrenceCounter()
    for (const row of block.rows) {
      const parts = { date: row.date, account: `td:${block.lastFour}`, amount: row.amount, originalStatement: row.description }
      const id = await transactionId(parts, nextOccurrence(parts))
      if (!plan.firstDate || row.date < plan.firstDate) plan.firstDate = row.date
      if (!plan.lastDate || row.date > plan.lastDate) plan.lastDate = row.date
      if (existing.has(id)) {
        plan.unchanged++
        continue
      }
      const outcome = categorize(row, account)
      const next: Transaction = {
        id,
        date: row.date,
        merchant: outcome.merchant,
        originalStatement: row.description,
        notes: '',
        amount: row.amount,
        currency: account.currency,
        accountId: account.id,
        monarchAccount: '',
        category: outcome.category,
        groupId: etmGroupFor(outcome.category, options.groups),
        internal: isInternalCategory(outcome.category),
        tags: outcome.tags,
        owner: '',
        reviewed: false,
        source: 'td',
        importBatchId: batchId,
        prediction: outcome.prediction,
        feedFile: fileName,
        ...(outcome.split && outcome.split.length > 0 ? { split: outcome.split } : {}),
        ...(row.balance === undefined ? {} : { balance: row.balance }),
      }
      if (next.internal) plan.internal++
      plan.added.push(next)
      months.add(monthOf(row.date))
    }
  }

  plan.months = [...months].sort()
  return plan
}
