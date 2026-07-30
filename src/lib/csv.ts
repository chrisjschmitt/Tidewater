import Papa from 'papaparse'
import {
  groupForCategory,
  isEssentialCategory,
  isInternalCategory,
  looksLikeIncome,
} from './categories'
import { uid } from './format'
import type { Budget, ExpenseLine, Goal, GroupId, IncomeLine, Profile } from './types'

export const DEFAULT_PROFILE: Profile = {
  name: '',
  housing: 'rent',
  household: 'single',
  dependents: 0,
  hasDebt: false,
  region: '',
}

function parseAmount(raw: string | number | undefined | null): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (!raw) return 0
  const text = String(raw).trim()
  const negated = /^\(.*\)$/.test(text)
  const cleaned = text.replace(/[()]/g, '').replace(/[^0-9.-]/g, '')
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return 0
  return negated ? -value : value
}

function readRows(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  return result.data.filter((row) => row && Object.keys(row).length > 0)
}

/** Case-insensitive column lookup, since exports vary in capitalisation. */
function pick(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row)
  for (const name of names) {
    const key = keys.find((k) => k.toLowerCase() === name.toLowerCase())
    if (key && row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim()
  }
  return ''
}

// ---------------------------------------------------------------------------
// Budget CSV (the simple, hand-editable format Tidewater exports and ships)
// ---------------------------------------------------------------------------

export interface BudgetCsvResult {
  income: IncomeLine[]
  expenses: ExpenseLine[]
  goals: Goal[]
  warnings: string[]
}

export function parseBudgetCsv(text: string): BudgetCsvResult {
  const rows = readRows(text)
  const income: IncomeLine[] = []
  const expenses: ExpenseLine[] = []
  const goals: Goal[] = []
  const warnings: string[] = []

  for (const row of rows) {
    const type = pick(row, 'Type', 'Kind').toLowerCase()
    const name = pick(row, 'Name', 'Category', 'Item', 'Subgroup')
    const amount = Math.abs(parseAmount(pick(row, 'Monthly Amount', 'Amount', 'Monthly')))

    if (type.startsWith('goal') || type.startsWith('debt')) {
      if (!name) continue
      goals.push({
        id: uid('goal'),
        name,
        kind: type.startsWith('debt') ? 'debt' : 'savings',
        target: Math.abs(parseAmount(pick(row, 'Target', 'Target Amount'))),
        current: Math.abs(parseAmount(pick(row, 'Current', 'Balance', 'Starting Balance'))),
        monthly: amount,
        annualRate: Math.abs(parseAmount(pick(row, 'Annual Rate %', 'Annual Rate', 'Rate'))),
      })
      continue
    }

    if (!name || amount === 0) continue

    if (type.startsWith('income')) {
      income.push({ id: uid('inc'), name, amount })
      continue
    }
    const declared = pick(row, 'Group', 'Group Id', 'GroupId').toLowerCase() as GroupId
    const groupId: GroupId = declared && isGroupId(declared) ? declared : groupForCategory(name)
    expenses.push({
      id: uid('exp'),
      name,
      groupId,
      amount,
      baseline: amount,
      essential: isEssentialCategory(name),
    })
  }

  if (income.length === 0) warnings.push('No income rows were found, so the summary will read as all outflow.')
  if (expenses.length === 0) warnings.push('No expense rows were found in this file.')
  return { income, expenses, goals, warnings }
}

const GROUP_IDS: GroupId[] = ['home', 'food', 'transport', 'health', 'personal', 'joy', 'family', 'financial', 'future', 'other']
const isGroupId = (v: string): v is GroupId => (GROUP_IDS as string[]).includes(v)

export function toBudgetCsv(budget: Budget): string {
  const lines = ['Type,Name,Group,Monthly Amount,Target,Current,Annual Rate %']
  for (const l of budget.income) lines.push(`Income,${csvCell(l.name)},,${l.amount.toFixed(2)},,,`)
  for (const l of budget.expenses)
    lines.push(`Expense,${csvCell(l.name)},${l.groupId},${l.amount.toFixed(2)},,,`)
  for (const g of budget.goals)
    lines.push(
      `${g.kind === 'debt' ? 'Debt' : 'Goal'},${csvCell(g.name)},,${g.monthly.toFixed(2)},${g.target.toFixed(2)},${g.current.toFixed(2)},${g.annualRate}`,
    )
  return lines.join('\n') + '\n'
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

// ---------------------------------------------------------------------------
// Transaction CSV (Monarch Money export, and similar shapes)
// ---------------------------------------------------------------------------

export interface TransactionImport {
  income: IncomeLine[]
  expenses: ExpenseLine[]
  months: number
  firstDate: string
  lastDate: string
  transactionCount: number
  skippedInternal: number
  note: string
}

export function parseTransactionsCsv(text: string): TransactionImport {
  return finalizeTransactionImport(accumulateTransactionRows(readRows(text)))
}

/**
 * Same as parseTransactionsCsv, but yields to the UI between batches so a large
 * Monarch export can show a progress bar instead of freezing the page.
 */
export async function parseTransactionsCsvAsync(
  text: string,
  onProgress?: (fraction: number) => void,
): Promise<TransactionImport> {
  const report = (fraction: number) => onProgress?.(Math.max(0, Math.min(1, fraction)))
  report(0)
  await yieldToUi()
  const rows = readRows(text)
  report(0.12)
  await yieldToUi()

  const buckets = new Map<string, { net: number; labels: Map<string, number> }>()
  let skippedInternal = 0
  let counted = 0
  let firstDate = ''
  let lastDate = ''
  const batch = Math.max(100, Math.ceil(rows.length / 40))

  for (let i = 0; i < rows.length; i++) {
    const outcome = ingestTransactionRow(rows[i]!, buckets)
    if (outcome === 'skip-empty') continue
    if (outcome === 'skip-internal') {
      skippedInternal++
      continue
    }
    counted++
    if (!firstDate || outcome.date < firstDate) firstDate = outcome.date
    if (!lastDate || outcome.date > lastDate) lastDate = outcome.date

    if (i > 0 && i % batch === 0) {
      report(0.12 + 0.8 * (i / rows.length))
      await yieldToUi()
    }
  }

  report(0.95)
  await yieldToUi()
  const result = finalizeTransactionImport({
    buckets,
    skippedInternal,
    counted,
    firstDate,
    lastDate,
  })
  report(1)
  return result
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type BucketMap = Map<string, { net: number; labels: Map<string, number> }>

function accumulateTransactionRows(rows: Record<string, string>[]) {
  const buckets: BucketMap = new Map()
  let skippedInternal = 0
  let counted = 0
  let firstDate = ''
  let lastDate = ''

  for (const row of rows) {
    const outcome = ingestTransactionRow(row, buckets)
    if (outcome === 'skip-empty') continue
    if (outcome === 'skip-internal') {
      skippedInternal++
      continue
    }
    counted++
    if (!firstDate || outcome.date < firstDate) firstDate = outcome.date
    if (!lastDate || outcome.date > lastDate) lastDate = outcome.date
  }

  return { buckets, skippedInternal, counted, firstDate, lastDate }
}

function ingestTransactionRow(
  row: Record<string, string>,
  buckets: BucketMap,
): 'skip-empty' | 'skip-internal' | { date: string } {
  const dateText = pick(row, 'Date', 'Transaction Date', 'Posted Date')
  const category = (pick(row, 'Category', 'Category Name') || 'Uncategorized').replace(/\s+/g, ' ').trim()
  const amount = parseAmount(pick(row, 'Amount', 'Value'))
  if (!dateText || amount === 0) return 'skip-empty'

  if (isInternalCategory(category)) return 'skip-internal'

  const date = dateText.slice(0, 10)
  const key = category.toLowerCase()
  const bucket = buckets.get(key) ?? { net: 0, labels: new Map<string, number>() }
  bucket.net += amount
  bucket.labels.set(category, (bucket.labels.get(category) ?? 0) + 1)
  buckets.set(key, bucket)
  return { date }
}

function finalizeTransactionImport(state: {
  buckets: BucketMap
  skippedInternal: number
  counted: number
  firstDate: string
  lastDate: string
}): TransactionImport {
  const { buckets, skippedInternal, counted, firstDate, lastDate } = state
  const months = monthSpan(firstDate, lastDate)
  const income: IncomeLine[] = []
  const expenses: ExpenseLine[] = []

  for (const bucket of buckets.values()) {
    const category = commonestLabel(bucket.labels)
    const monthly = bucket.net / months
    // Ignore rounding dust so the dashboard is not littered with $0 rows.
    if (Math.abs(monthly) < 1) continue

    if (monthly > 0 || looksLikeIncome(category)) {
      if (monthly <= 0) continue
      income.push({ id: uid('inc'), name: category, amount: round2(monthly) })
    } else {
      expenses.push({
        id: uid('exp'),
        name: category,
        groupId: groupForCategory(category),
        amount: round2(Math.abs(monthly)),
        observed: round2(Math.abs(monthly)),
        essential: isEssentialCategory(category),
      })
    }
  }

  income.sort((a, z) => z.amount - a.amount)
  expenses.sort((a, z) => z.amount - a.amount)

  return {
    income,
    expenses,
    months,
    firstDate,
    lastDate,
    transactionCount: counted,
    skippedInternal,
    note: `Averaged from ${counted.toLocaleString()} transactions across ${months} month${months === 1 ? '' : 's'} (${firstDate} to ${lastDate}).`,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

const AVG_DAYS_PER_MONTH = 30.44

/**
 * Elapsed months between the first and last transaction. Counting distinct
 * calendar months overstates the span — a year of data that starts on the 30th
 * touches 13 of them — which would quietly deflate every monthly average.
 */
function monthSpan(firstDate: string, lastDate: string): number {
  const start = Date.parse(firstDate)
  const end = Date.parse(lastDate)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1
  const days = (end - start) / 86_400_000 + 1
  return Math.max(1, Math.round(days / AVG_DAYS_PER_MONTH))
}

/** Prefer the spelling the export used most often. */
function commonestLabel(labels: Map<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [label, count] of labels) {
    if (count > bestCount) {
      best = label
      bestCount = count
    }
  }
  return best
}

/** Sniff whether a dropped file is a transaction log or a Tidewater budget. */
export function detectCsvKind(text: string): 'transactions' | 'budget' {
  const header = text.slice(0, text.indexOf('\n') + 1).toLowerCase()
  if (header.includes('merchant') || header.includes('date')) return 'transactions'
  if (header.includes('monthly amount') || header.includes('type')) return 'budget'
  return 'transactions'
}
