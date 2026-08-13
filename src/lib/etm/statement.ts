import Papa from 'papaparse'

/**
 * A bank or card statement, read for one thing only: the closing balance.
 *
 * Statements are deliberately **not** a second source of transactions (§9).
 * Matching them against Monarch rows would mean a whole dedup layer between
 * two feeds of the same purchases, and the reconciliation only ever needed
 * the anchor at the end.
 *
 * These files are headerless: date, description, debit, credit, running
 * balance. Bank exports write ISO dates and card exports write MM/DD/YYYY,
 * so both are accepted and the ambiguity that remains is reported rather
 * than guessed at.
 */

export interface StatementReading {
  /** The last row's date — the balance's "as of". */
  date: string
  balance: number
  /** Rows read, so the user can tell a truncated file from a whole one. */
  rows: number
  firstDate: string
}

export class StatementFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatementFormatError'
  }
}

export function parseStatementCsv(text: string): StatementReading {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' })
  const rows = (parsed.data ?? []).filter((row) => row.some((cell) => cell?.trim()))

  if (rows.length === 0) {
    throw new StatementFormatError('This file has no rows in it.')
  }

  // A statement that happens to carry headings is common enough to survive.
  const body = looksLikeHeading(rows[0]!) ? rows.slice(1) : rows

  const readings: Array<{ date: string; balance: number }> = []
  for (const row of body) {
    const date = parseStatementDate(row[0] ?? '')
    const balance = parseNumber(row[row.length - 1] ?? '')
    if (!date || balance === null) continue
    readings.push({ date, balance })
  }

  if (readings.length === 0) {
    throw new StatementFormatError(
      'No date and running balance could be read. These files are expected to hold date, description, debit, credit and running balance, in that order and with no headings.',
    )
  }

  // Statements arrive both oldest-first and newest-first, so the closing
  // balance is the latest date rather than the last line.
  const sorted = [...readings].sort((a, z) => a.date.localeCompare(z.date))
  const closing = sorted[sorted.length - 1]!

  return {
    date: closing.date,
    balance: closing.balance,
    rows: readings.length,
    firstDate: sorted[0]!.date,
  }
}

const looksLikeHeading = (row: string[]) =>
  row.length > 0 && parseStatementDate(row[0] ?? '') === '' && /[a-z]/i.test(row[0] ?? '')

/**
 * ISO from the bank, MM/DD/YYYY from the card. A slashed date whose first
 * part is above twelve can only be DD/MM, so it is read that way rather than
 * silently landing on the wrong day.
 */
export function parseStatementDate(raw: string): string {
  const value = raw.trim()
  if (!value) return ''

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) return value

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value)
  if (slashed) {
    const [, a, b, y] = slashed
    const first = Number(a)
    const second = Number(b)
    const year = y!.length === 2 ? `20${y}` : y!
    const [month, day] = first > 12 ? [second, first] : [first, second]
    if (month < 1 || month > 12 || day < 1 || day > 31) return ''
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return ''
}

function parseNumber(raw: string): number | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const negated = /^\(.*\)$/.test(value)
  const cleaned = value.replace(/[()]/g, '').replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const parsed = Number.parseFloat(cleaned)
  if (!Number.isFinite(parsed)) return null
  return negated ? -parsed : parsed
}
