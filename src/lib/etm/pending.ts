import type { GroupId } from '../types'
import type { TdCutover } from './config'
import type { TdCategorizer } from './importer'
import { counts, splitParts, tdAccountIds } from './ledger'
import { etmGroupFor } from './groups'
import { isInternalCategory } from '../categories'
import type { Account, Transaction } from './types'

/**
 * Card charges still pending at TD. TD's export holds posted transactions
 * only, so a purchase is missing for the day or three it is pending; the
 * downloader reads each card's pending list off its EasyWeb page into
 * `TD-pending-<date>.json`, beside the combined file.
 *
 * Pending charges are never stored as transactions. The latest reading is
 * kept in the settings and turned into budget rows on the fly — filed by the
 * same rules as a TD row — so they count in spent and the forecast but not in
 * balances or the month-end reconciliation (TD's balances leave them out too).
 * A charge drops away by itself once its posted copy arrives, and a whole
 * reading is ignored once a later download has come in without a fresh one.
 */

export interface PendingCharge {
  date: string
  description: string
  amount: number
}

export interface PendingAccount {
  accountId: string
  lastFour: string
  label: string
  readAt: string
  total: number
  charges: PendingCharge[]
}

export interface PendingSnapshot {
  /** The day the downloader read it (its file's date). */
  date: string
  fileName: string
  accounts: PendingAccount[]
}

const NAME = /^TD-pending-(\d{4}-\d{2}-\d{2})\.json$/

export function isPendingFileName(name: string): boolean {
  return NAME.test(name.trim())
}

/** The newest pending file among some names. */
export function newestPending(names: string[]): { name: string; date: string } | undefined {
  return names
    .map((name) => name.trim().match(NAME))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ name: m[0], date: m[1]! }))
    .sort((a, z) => z.date.localeCompare(a.date))[0]
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Reads the downloader's file; accounts matched by last four. Null if it isn't one. */
export function parsePendingFile(text: string, fileName: string, accounts: Account[]): PendingSnapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const file = parsed as { date?: unknown; accounts?: unknown }
  if (typeof file.date !== 'string' || !Array.isArray(file.accounts)) return null
  const out: PendingAccount[] = []
  for (const item of file.accounts as Array<Record<string, unknown>>) {
    const lastFour = String(item.lastFour ?? '')
    const account = accounts.find((a) => a.lastFour === lastFour)
    if (!account || !isNumber(item.total) || !Array.isArray(item.charges)) continue
    const charges = (item.charges as Array<Record<string, unknown>>)
      .filter((c) => typeof c.date === 'string' && typeof c.description === 'string' && isNumber(c.amount))
      .map((c) => ({ date: c.date as string, description: c.description as string, amount: c.amount as number }))
    out.push({
      accountId: account.id,
      lastFour,
      label: String(item.label ?? account.nickname),
      readAt: String(item.readAt ?? file.date),
      total: item.total,
      charges,
    })
  }
  return { date: file.date, fileName, accounts: out }
}

const DAY_MS = 86_400_000
const cents = (n: number) => Math.round(n * 100)

export interface PendingOptions {
  accounts: Account[]
  cutover?: TdCutover
  categorize: TdCategorizer
  groups?: Record<string, GroupId>
}

/**
 * The pending charges still worth counting, as budget rows (split parts where
 * a rule splits them). Each has `pending: true` and an id that never collides
 * with a stored row.
 */
export function pendingRows(snapshot: PendingSnapshot | undefined, all: Transaction[], options: PendingOptions): Transaction[] {
  if (!snapshot) return []
  const tdAccounts = tdAccountIds(all)
  const out: Transaction[] = []
  for (const reading of snapshot.accounts) {
    const account = options.accounts.find((a) => a.id === reading.accountId)
    if (!account) continue
    const posted = all.filter((row) => row.source === 'td' && row.accountId === account.id && !row.duplicateOf)
    // A download read after this reading has the fresher picture.
    const newer = (name = '') => name.startsWith('TD-transactions-') && name > `TD-transactions-${snapshot.date}.csv`
    if (posted.some((row) => newer(row.feedFile))) continue
    const used = new Set<string>()
    reading.charges.forEach((charge, index) => {
      // Its posted copy is in: same amount, posted the same day or within a week.
      const match = posted.find((row) => {
        if (used.has(row.id) || cents(row.amount) !== cents(charge.amount)) return false
        const days = (Date.parse(row.date) - Date.parse(charge.date)) / DAY_MS
        return days >= -1 && days <= 7
      })
      if (match) {
        used.add(match.id)
        return
      }
      const outcome = options.categorize(
        { account: reading.label, lastFour: reading.lastFour, date: charge.date, description: charge.description, amount: charge.amount },
        account,
      )
      const row: Transaction = {
        id: `pending|${reading.lastFour}|${snapshot.date}|${index}`,
        date: charge.date,
        merchant: outcome.merchant,
        originalStatement: charge.description,
        notes: '',
        amount: charge.amount,
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
        importBatchId: 'pending',
        pending: true,
        ...(outcome.split && outcome.split.length > 0 ? { split: outcome.split } : {}),
      }
      if (!counts(row, options.cutover, { tdAccounts })) return
      out.push(...splitParts(row, options.groups))
    })
  }
  return out
}

/** Total of the charges counted, for the notice (money out as a positive figure). */
export function pendingTotal(rows: Transaction[]): number {
  return Math.round(rows.reduce((s, r) => s - r.amount, 0) * 100) / 100
}
