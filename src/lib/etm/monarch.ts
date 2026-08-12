import Papa from 'papaparse'

/**
 * The Monarch CSV reader, and nothing else.
 *
 * This file is the swap point described in §9.1: it knows the shape of one
 * export format and produces plain rows. Dedup, group derivation, account
 * matching and storage all happen downstream, so a second feed can be added
 * later by writing another module like this one and touching nothing else.
 */

/** One export line, converted to types but not yet interpreted. */
export interface MonarchRow {
  date: string
  merchant: string
  category: string
  account: string
  originalStatement: string
  notes: string
  amount: number
  tags: string[]
  owner: string
  reviewed: boolean
}

export interface MonarchParseResult {
  rows: MonarchRow[]
  /** Lines with no date or no amount — usually a trailing note in the file. */
  skipped: number
}

/** Without these there is nothing to import; the rest of the columns are optional. */
const REQUIRED_COLUMNS = ['Date', 'Merchant', 'Category', 'Account', 'Amount']

export class MonarchFormatError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `This file is missing the ${missing.length === 1 ? 'column' : 'columns'} ${missing
        .map((c) => `“${c}”`)
        .join(', ')}. Monarch exports include ${REQUIRED_COLUMNS.map((c) => `“${c}”`).join(
        ', ',
      )} — if Monarch has changed its export, the file will need those headings.`,
    )
    this.name = 'MonarchFormatError'
  }
}

export function parseMonarchCsv(text: string): MonarchParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  const headers = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((needed) => !has(headers, needed))
  if (missing.length > 0) throw new MonarchFormatError(missing)

  const rows: MonarchRow[] = []
  let skipped = 0

  for (const raw of parsed.data) {
    if (!raw || Object.keys(raw).length === 0) continue
    const date = normalizeDate(cell(raw, 'Date'))
    const amount = parseAmount(cell(raw, 'Amount'))
    if (!date || amount === 0) {
      skipped++
      continue
    }
    rows.push({
      date,
      merchant: cell(raw, 'Merchant'),
      category: collapse(cell(raw, 'Category')) || 'Uncategorized',
      account: cell(raw, 'Account'),
      originalStatement: cell(raw, 'Original Statement', 'Original Description'),
      notes: cell(raw, 'Notes', 'Note'),
      amount,
      tags: splitTags(cell(raw, 'Tags')),
      owner: cell(raw, 'Owner'),
      reviewed: isTruthy(cell(raw, 'Reviewed')),
    })
  }

  return { rows, skipped }
}

const has = (headers: string[], name: string) =>
  headers.some((h) => h.toLowerCase() === name.toLowerCase())

function cell(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row)
  for (const name of names) {
    const key = keys.find((k) => k.toLowerCase() === name.toLowerCase())
    const value = key ? row[key] : undefined
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Monarch exports ISO dates; anything else is taken as far as it parses. */
function normalizeDate(raw: string): string {
  if (!raw) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso) return raw.slice(0, 10)
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw)
  if (slashed) {
    const [, m, d, y] = slashed
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
  }
  return ''
}

function parseAmount(raw: string): number {
  if (!raw) return 0
  const negated = /^\(.*\)$/.test(raw)
  const value = Number.parseFloat(raw.replace(/[()]/g, '').replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(value)) return 0
  return negated ? -value : value
}

function splitTags(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

const isTruthy = (raw: string) => /^(true|yes|y|1)$/i.test(raw.trim())
