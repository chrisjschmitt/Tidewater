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
  /**
   * The closing balance at the end of each day in the file, oldest first,
   * with that day's row count — so a month can be closed on its own last day
   * even when the file runs past it (see `readingThrough`).
   */
  byDay?: Array<{ date: string; balance: number; rows: number }>
  /** Every row's running balance follows from its neighbour's (see balancesChain). */
  chained?: boolean
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

  const readings: Array<{ date: string; balance: number; change: number }> = []
  for (const row of body) {
    const date = parseStatementDate(row[0] ?? '')
    // The running balance is the last filled cell: card exports end each line
    // with an empty extra column.
    const cells = row.map((cell) => (cell ?? '').trim())
    let last = cells.length - 1
    while (last > 1 && cells[last] === '') last--
    const balance = parseNumber(cells[last] ?? '')
    if (!date || balance === null) continue
    // Debit minus credit; its sign against the balance differs between bank
    // and card files, which fileRunsNewestFirst tries both ways.
    const change = (last > 2 ? (parseNumber(cells[2] ?? '') ?? 0) - (parseNumber(cells[3] ?? '') ?? 0) : 0)
    readings.push({ date, balance, change })
  }

  if (readings.length === 0) {
    throw new StatementFormatError(
      'No date and running balance could be read. These files are expected to hold date, description, debit, credit and running balance, in that order and with no headings.',
    )
  }

  // Statements arrive both oldest-first (bank) and newest-first (card), so the
  // closing balance is the latest date rather than the last line. Several rows
  // can share that date, and then the file's own order decides: in a
  // newest-first file the closing row is the first of them, not the last.
  const sorted = [...readings].sort((a, z) => a.date.localeCompare(z.date))
  const latest = sorted[sorted.length - 1]!.date
  const newestFirst = fileRunsNewestFirst(readings)
  const closingOn = (date: string) => {
    const on = readings.filter((reading) => reading.date === date)
    return { row: newestFirst ? on[0]! : on[on.length - 1]!, rows: on.length }
  }
  const closing = closingOn(latest).row
  const days = [...new Set(sorted.map((reading) => reading.date))]

  return {
    date: closing.date,
    balance: closing.balance,
    rows: readings.length,
    firstDate: sorted[0]!.date,
    byDay: days.map((date) => {
      const { row, rows } = closingOn(date)
      return { date, balance: row.balance, rows }
    }),
    chained: balancesChain(readings),
  }
}

/**
 * The reading as it stood at the end of `end`, when the file runs past it.
 * TD dates weekend and holiday activity on a chequing account with the next
 * business day, and its running balance already includes it — so the month's
 * closing balance is the one after the last row dated within the month.
 * Undefined when the file has nothing on or before `end`, or no daily balances.
 */
export function readingThrough(
  reading: StatementReading,
  end: string,
): { reading: StatementReading; later: { rows: number; firstDate: string } } | undefined {
  if (reading.date <= end || !reading.byDay) return undefined
  const upTo = reading.byDay.filter((day) => day.date <= end)
  const last = upTo[upTo.length - 1]
  if (!last) return undefined
  const after = reading.byDay.filter((day) => day.date > end)
  return {
    reading: {
      date: last.date,
      balance: last.balance,
      rows: upTo.reduce((sum, day) => sum + day.rows, 0),
      firstDate: reading.firstDate,
      byDay: upTo,
    },
    later: { rows: after.reduce((sum, day) => sum + day.rows, 0), firstDate: after[0]!.date },
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

export function parseNumber(raw: string): number | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const negated = /^\(.*\)$/.test(value)
  const cleaned = value.replace(/[()]/g, '').replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const parsed = Number.parseFloat(cleaned)
  if (!Number.isFinite(parsed)) return null
  return negated ? -parsed : parsed
}

/**
 * Which way a statement runs. The running balance says it most reliably: in
 * file order, each balance either follows from the one above it (oldest
 * first) or leads to it (newest first). Dates decide only when the balances
 * cannot — every row on one day is common enough on a card.
 */
function chainCounts(readings: Array<{ date: string; balance: number; change: number }>): { ascending: number; descending: number } {
  const close = (a: number, b: number) => Math.abs(a - b) < 0.005
  let ascending = 0
  let descending = 0
  for (let i = 1; i < readings.length; i++) {
    const before = readings[i - 1]!
    const here = readings[i]!
    if (close(here.balance, before.balance + here.change) || close(here.balance, before.balance - here.change)) ascending++
    if (close(before.balance, here.balance + before.change) || close(before.balance, here.balance - before.change)) descending++
  }
  return { ascending, descending }
}

function fileRunsNewestFirst(readings: Array<{ date: string; balance: number; change: number }>): boolean {
  const { ascending, descending } = chainCounts(readings)
  if (ascending !== descending) return descending > ascending
  return readings[0]!.date > readings[readings.length - 1]!.date
}

/**
 * Every row's running balance follows from the one beside it, one way or the
 * other — so a day's closing balance can be trusted as of that day, not just
 * the file's last. Card files can be joined from two exports; a join that
 * doesn't chain fails this and the file is only trusted at its end.
 */
function balancesChain(readings: Array<{ date: string; balance: number; change: number }>): boolean {
  if (readings.length < 2) return false
  const { ascending, descending } = chainCounts(readings)
  return Math.max(ascending, descending) === readings.length - 1
}
