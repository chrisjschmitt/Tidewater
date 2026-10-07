import Papa from 'papaparse'
import { parseNumber, parseStatementDate } from './statement'

/**
 * The TD downloader's combined file, `TD-transactions-<YYYY-MM-DD>.csv`:
 *
 *     Account,Last four,Date,Description,Debit,Credit,Balance
 *
 * One file holds every account's rows for the day's download, so a single read
 * gives both the closing balances (the Closing balances step) and the
 * transactions themselves (the TD feed). Nothing here touches the browser.
 */

const COMBINED_NAME = /^TD-transactions-(\d{4}-\d{2}-\d{2})\.csv$/i

export interface CombinedFileName {
  name: string
  /** The download day. */
  date: string
}

export function parseCombinedFileName(name: string): CombinedFileName | undefined {
  const match = COMBINED_NAME.exec(name.trim())
  if (!match) return undefined
  return { name: name.trim(), date: match[1]! }
}

export const isCombinedFileName = (name: string): boolean => COMBINED_NAME.test(name.trim())

/** The latest combined file among a folder listing, if there is one. */
export function newestCombined(names: string[]): CombinedFileName | undefined {
  let best: CombinedFileName | undefined
  for (const name of names) {
    const parsed = parseCombinedFileName(name)
    if (parsed && (!best || parsed.date > best.date)) best = parsed
  }
  return best
}

/** One row as TD printed it, with the account it came from. */
export interface TdFeedRow {
  account: string
  lastFour: string
  date: string
  /** Whitespace collapsed, otherwise as TD wrote it (Monarch's “Original Statement”). */
  description: string
  /** Signed like Monarch: money out is negative. */
  amount: number
  balance?: number
}

/** The rows of one account within the combined file, in file order. */
export interface TdAccountBlock {
  account: string
  lastFour: string
  rows: TdFeedRow[]
  /** The same rows as a headerless per-account export, for the balance reader. */
  asStatementText: string
}

export class TdFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TdFileError'
  }
}

const REQUIRED = ['Account', 'Last four', 'Date', 'Description', 'Debit', 'Credit', 'Balance']

export const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function parseTdCombinedCsv(text: string): TdAccountBlock[] {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const headers = (parsed.meta.fields ?? []).map((h) => h.toLowerCase())
  const missing = REQUIRED.filter((name) => !headers.includes(name.toLowerCase()))
  if (missing.length > 0) {
    throw new TdFileError(
      `This does not read as the TD downloader's combined file: it is missing ${missing.join(', ')}.`,
    )
  }

  const blocks = new Map<string, TdAccountBlock>()
  const lines = new Map<string, string[]>()
  for (const raw of parsed.data) {
    const get = (name: string) => {
      const key = Object.keys(raw).find((k) => k.toLowerCase() === name.toLowerCase())
      return key ? String(raw[key] ?? '').trim() : ''
    }
    const date = parseStatementDate(get('Date'))
    if (!date) continue
    const debit = parseNumber(get('Debit')) ?? 0
    const credit = parseNumber(get('Credit')) ?? 0
    const amount = round2(credit - debit)
    if (amount === 0) continue
    const lastFour = get('Last four')
    const account = get('Account')
    const key = `${lastFour}|${account.toLowerCase()}`
    let block = blocks.get(key)
    if (!block) {
      block = { account, lastFour, rows: [], asStatementText: '' }
      blocks.set(key, block)
      lines.set(key, [])
    }
    const balance = parseNumber(get('Balance'))
    block.rows.push({
      account,
      lastFour,
      date,
      description: collapseWhitespace(get('Description')),
      amount,
      ...(balance === null ? {} : { balance }),
    })
    lines.get(key)!.push(
      [date, get('Description'), get('Debit'), get('Credit'), get('Balance')].map(csvCell).join(','),
    )
  }

  for (const [key, block] of blocks) block.asStatementText = lines.get(key)!.join('\n')
  if (blocks.size === 0) throw new TdFileError('That combined file holds no transaction rows.')
  return [...blocks.values()]
}

/**
 * The per-account file name the downloader would have written for this block.
 * Lets the combined file reuse the folder matching (last four first, then the
 * label) unchanged, so both kinds of file land on the same accounts.
 */
export function pseudoFileName(block: TdAccountBlock, date: string): string {
  const slug = block.account
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `TD-${slug}-${block.lastFour}-${date}.csv`
}

const round2 = (n: number) => Math.round(n * 100) / 100

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
