import type { StatementReading } from './statement'
import { isCombinedFileName } from './td'
import type { Account, BalanceSnapshot } from './types'

/**
 * A folder of TD statement exports, read in one pass for closing balances.
 *
 * The single-file flow in the Balances step is fine for one account and
 * tedious for nine, so the same reading is done for the whole folder at once.
 * What comes out is still only a closing balance per account (§9): the rows
 * inside the files are no more imported here than they were one at a time.
 *
 * Everything below is deliberately free of the browser: filenames arrive as
 * strings and file contents as already-parsed readings, so the matching can
 * be checked without a folder, a picker, or a permission prompt.
 */

/** `TD-<label-slug>-<lastFour>-<YYYY-MM-DD>.csv`, as the downloader writes it. */
const FILE_NAME = /^TD-(.+)-(\d{4})-(\d{4}-\d{2}-\d{2})\.csv$/i

export interface StatementFileName {
  /** The name as it sits in the folder, kept for provenance on the snapshot. */
  name: string
  labelSlug: string
  lastFour: string
  /** The day the file was downloaded — not the statement's own closing date. */
  date: string
}

/** Lowercased, with every run of non-alphanumerics collapsed to one dash. */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseStatementFileName(name: string): StatementFileName | undefined {
  const match = FILE_NAME.exec(name.trim())
  if (!match) return undefined
  const [, labelSlug, lastFour, date] = match
  // A filename can be shaped like a date and not be one, and a file we cannot
  // date is a file we cannot order — so it is set aside rather than guessed at.
  if (!isRealDate(date!)) return undefined
  return { name: name.trim(), labelSlug: labelSlug!.toLowerCase(), lastFour: lastFour!, date: date! }
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.toISOString().slice(0, 10) === iso
}

export interface FolderScan {
  files: StatementFileName[]
  /** Names that look like our exports but do not read as one, so they are said aloud. */
  skipped: string[]
}

/** A flat listing, filtered to the downloader's own files. Subfolders are ignored. */
export function scanStatementNames(names: string[]): FolderScan {
  const files: StatementFileName[] = []
  const skipped: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!/^TD-.*\.csv$/i.test(trimmed)) continue
    // The downloader's combined file is read by td.ts, not as one account's export.
    if (isCombinedFileName(trimmed)) continue
    const parsed = parseStatementFileName(trimmed)
    if (parsed) files.push(parsed)
    else skipped.push(trimmed)
  }
  return { files, skipped }
}

export interface FolderMatch {
  /** Account id → the file chosen for it. */
  byAccount: Map<string, StatementFileName>
  /** Files belonging to no account in the registry. */
  unmatched: StatementFileName[]
  /** Earlier downloads of an account whose file was read from a later one. */
  superseded: StatementFileName[]
  /** Names that look like our exports but do not read as one. */
  skipped: string[]
}

/**
 * Last four digits first: they are the one thing on an account that a bank
 * and a nickname agree on. The slug is the fallback, for an account recorded
 * without its digits and for the case where two accounts share them — a card
 * held in both currencies, say.
 *
 * A file claimed by one account leaves the pool, so nine files can never be
 * read as the same balance twice.
 */
export function matchStatementFiles(accounts: Account[], names: string[]): FolderMatch {
  const { files: pool, skipped } = scanStatementNames(names)
  const claimed = new Set<string>()
  const superseded: StatementFileName[] = []
  const byAccount = new Map<string, StatementFileName>()

  const free = () => pool.filter((file) => !claimed.has(file.name))
  const take = (account: Account, candidates: StatementFileName[]) => {
    const chosen = newest(candidates)
    if (!chosen) return
    claimed.add(chosen.name)
    byAccount.set(account.id, chosen)
    // Earlier downloads of the same account — same digits, same label, an
    // older day — are the same statement twice. They are accounted for as
    // superseded so they cannot later be reported as belonging to nobody.
    for (const file of candidates) {
      if (file.name === chosen.name) continue
      if (file.lastFour !== chosen.lastFour || file.labelSlug !== chosen.labelSlug) continue
      claimed.add(file.name)
      superseded.push(file)
    }
  }

  for (const account of accounts) {
    const digits = account.lastFour?.trim()
    if (!digits) continue
    const candidates = free().filter((file) => file.lastFour === digits)
    if (candidates.length === 0) continue
    const slug = slugifyLabel(account.nickname)
    const narrowed = candidates.filter((file) => file.labelSlug === slug)
    take(account, candidates.length > 1 && narrowed.length > 0 ? narrowed : candidates)
  }

  for (const account of accounts) {
    if (byAccount.has(account.id)) continue
    const slug = slugifyLabel(account.nickname)
    if (!slug) continue
    take(
      account,
      free().filter((file) => file.labelSlug === slug),
    )
  }

  return { byAccount, unmatched: free(), superseded, skipped }
}

/** Several downloads of one account: the latest one is the one that closed it. */
function newest(files: StatementFileName[]): StatementFileName | undefined {
  if (files.length === 0) return undefined
  return files.reduce((best, file) => (file.date > best.date ? file : best))
}

/**
 * The accounts the Closing balances step asks about: whatever pays for
 * everything, whatever is cleared each month, and anything that is not a
 * plain chequing account. Shared with the step itself so the batch read and
 * the one-at-a-time list can never come to disagree about who is on it.
 */
export function balanceAnchors(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.funding || a.mainCard || a.kind !== 'chequing')
}

/**
 * A card's running balance arrives negative from TD — what is owed, written
 * as a debt. Snapshots hold what is owed as a positive number and leave the
 * sign to the reconciliation, which applies it in one place. Typing a balance
 * in, the user does that conversion by hand; reading nine files, nobody is
 * there to, so it is done here.
 */
export function closingBalanceOf(account: Account, reading: StatementReading): number {
  return account.kind === 'credit' ? Math.abs(reading.balance) : reading.balance
}

/** What came of trying to read one matched file. Exactly one of the two is set. */
export interface StatementRead {
  file: StatementFileName
  reading?: StatementReading
  /** The `StatementFormatError` message, or whatever else went wrong. */
  error?: string
}

export interface StatementReviewRow {
  account: Account
  file?: StatementFileName
  reading?: StatementReading
  /** What would be stored, sign already settled. */
  balance?: number
  error?: string
  /**
   * The statement closed outside the month being settled. Still offered —
   * the user may know why — but not silently recorded as that month's anchor.
   */
  outsideMonth?: boolean
  /**
   * The balance holds unchanged from this earlier date: the account had no
   * transactions between it and the download, so the figure is recorded as of
   * the download (within the month) rather than left out of the month.
   */
  carriedFrom?: string
  /** The date the snapshot is recorded at, when it differs from the last row's. */
  asOf?: string
}

/** What a carried-forward balance needs: the day of the download, and what is already recorded. */
export interface CarryContext {
  /** Download day of the combined file; accounts absent from it are carried from `balances`. */
  downloadDate?: string
  balances: BalanceSnapshot[]
  fileName?: string
}

const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}

/** The day inside `month` a balance unchanged since before the month is recorded at, or nothing. */
function carryDate(month: string, downloadDate: string | undefined): string | undefined {
  if (!downloadDate || downloadDate < `${month}-01`) return undefined
  const end = monthEnd(month)
  return downloadDate > end ? end : downloadDate
}

function latestBefore(balances: BalanceSnapshot[], accountId: string, date: string): BalanceSnapshot | undefined {
  return balances
    .filter((b) => b.accountId === accountId && b.date < date)
    .sort((a, z) => z.date.localeCompare(a.date))[0]
}

/**
 * One row per account the step shows, in the step's own order, whether or not
 * a file was found for it. An account with nothing to read is still listed:
 * a missing balance is the thing most worth noticing here.
 */
export function reviewRows(
  accounts: Account[],
  reads: Map<string, StatementRead>,
  month: string,
  carry?: CarryContext,
): StatementReviewRow[] {
  return balanceAnchors(accounts).map((account) => {
    const read = reads.get(account.id)
    if (!read) {
      // Missing from the downloader's combined file: TD exports nothing for an
      // account with no transactions, so its last recorded balance still holds.
      const asOf = carryDate(month, carry?.downloadDate)
      const previous = asOf && account.lastFour?.trim() ? latestBefore(carry!.balances, account.id, `${month}-01`) : undefined
      if (!asOf || !previous) return { account }
      return {
        account,
        file: { name: carry?.fileName ?? 'TD download', labelSlug: '', lastFour: account.lastFour ?? '', date: carry!.downloadDate! },
        reading: { date: previous.date, balance: previous.balance, rows: 0, firstDate: previous.date },
        balance: previous.balance,
        carriedFrom: previous.date,
        asOf,
      }
    }
    if (!read.reading) {
      return { account, file: read.file, error: read.error ?? 'That file could not be read.' }
    }
    const balance = closingBalanceOf(account, read.reading)
    if (read.reading.date.slice(0, 7) === month) return { account, file: read.file, reading: read.reading, balance }
    // The last row is from before the month, and the file was downloaded
    // within (or after) it: nothing has moved since, so the balance holds.
    const asOf = read.reading.date < `${month}-01` ? carryDate(month, read.file.date) : undefined
    if (asOf) return { account, file: read.file, reading: read.reading, balance, carriedFrom: read.reading.date, asOf }
    return { account, file: read.file, reading: read.reading, balance, outsideMonth: true }
  })
}

/** True when the row holds a figure that can be recorded. */
export function isReadable(
  row: StatementReviewRow,
): row is StatementReviewRow & { file: StatementFileName; reading: StatementReading; balance: number } {
  return Boolean(row.file && row.reading && typeof row.balance === 'number')
}

/**
 * The snapshot a confirmed row becomes. The id is passed in rather than made
 * here so an existing balance for the month is updated instead of joined by a
 * second one, and so this stays free of anything random.
 */
export function snapshotFor(
  row: StatementReviewRow,
  id: string,
  existing?: BalanceSnapshot,
): BalanceSnapshot | undefined {
  if (!isReadable(row)) return undefined
  return {
    id,
    accountId: row.account.id,
    date: row.asOf ?? row.reading.date,
    balance: row.balance,
    // Pending charges appear in no export, so a batch read cannot learn them.
    // Whatever the user typed in before is kept rather than quietly dropped.
    ...(existing?.pending ? { pending: existing.pending } : {}),
    source: 'statement',
    fileName: row.file.name,
  }
}

/** Where one account stands while a download runs, judged from file names alone. */
export type DownloadState = 'waiting' | 'downloaded'

export interface DownloadProgress {
  accounts: Array<{ account: Account; state: DownloadState }>
  /** The combined file for the day, once the downloader has written it. */
  combined?: string
}

/**
 * Progress of today's download, from a listing of the statement folder and its
 * `raw/` subfolder. Only names are looked at: an account is downloaded once its
 * `TD-<label>-<last four>-<day>.csv` appears in either place, and the run is
 * finished when `TD-transactions-<day>.csv` does.
 */
export function downloadProgress(accounts: Account[], names: string[], day: string): DownloadProgress {
  const todays = names.filter((name) => parseStatementFileName(name)?.date === day)
  const match = matchStatementFiles(accounts, todays)
  const combined = names.find((name) => name.trim().toLowerCase() === `td-transactions-${day}.csv`)
  return {
    accounts: accounts
      .filter((account) => account.lastFour?.trim())
      .map((account) => ({ account, state: match.byAccount.has(account.id) ? 'downloaded' : 'waiting' })),
    ...(combined ? { combined: combined.trim() } : {}),
  }
}
