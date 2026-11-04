import type { GroupId } from '../types'
import type { Account, Transaction } from './types'
import type { Period } from './period'
import { ledgerView } from './ledger'
import { countsAsBudgetSpend } from './review'
import { pairFeeds } from './rules/compare'

/**
 * Budget spend day by day as Monarch would count it beside as TD would, with
 * the rows behind each day lined up: a TD row next to the Monarch row (or
 * split rows) for the same purchase, rows only one feed has, and rows the
 * two share (hand-entered rows, accounts with no TD feed).
 *
 * Both sides are read the same way the budget reads them — Monarch's world is
 * the ledger with no switch-over; TD's is the ledger switched over for every
 * TD account — so each side's month total is that feed's budget spend.
 */

export type LineKind = 'paired' | 'monarchOnly' | 'tdOnly' | 'shared'

export interface CompareLine {
  kind: LineKind
  /** Ledger rows (split parts) on each side. Shared rows sit on both sides. */
  monarch: Transaction[]
  td: Transaction[]
  /** Budget spend this line adds within the period, per side. */
  monarchSpend: number
  tdSpend: number
}

export interface CompareDay {
  date: string
  monarchSpend: number
  tdSpend: number
  lines: CompareLine[]
}

const DAY_MS = 86_400_000
const round = (n: number) => Math.round(n * 100) / 100
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10)
const parentOf = (row: Transaction) => row.id.split('#')[0]!

export interface DailyCompareOptions {
  period: Period
  accounts: Account[]
  reimbursableTag: string
  groups?: Record<string, GroupId>
  cutoffs?: Record<string, string>
}

export function dailyCompare(all: Transaction[], options: DailyCompareOptions): CompareDay[] {
  const { period, accounts, reimbursableTag } = options
  const ledgerOptions = options.cutoffs ? { cutoffs: options.cutoffs } : {}
  const monarchWorld = ledgerView(all, undefined, options.groups, ledgerOptions)
  const tdWorld = ledgerView(all, { global: '0000-01-01', perAccount: {} }, options.groups, ledgerOptions)

  // A few days either side, so a purchase the feeds date across the period's
  // edge still lines up with its partner (it counts in the other period).
  const from = shift(period.start, -5)
  const to = shift(period.end, 5)
  const near = (row: Transaction) => row.date >= from && row.date <= to
  const inPeriod = (date: string) => date >= period.start && date <= period.end

  const group = (rows: Transaction[]) => {
    const out = new Map<string, Transaction[]>()
    for (const row of rows.filter(near)) out.set(parentOf(row), [...(out.get(parentOf(row)) ?? []), row])
    return out
  }
  const monarchParts = group(monarchWorld)
  const tdParts = group(tdWorld)

  const spendOf = (rows: Transaction[]) =>
    round(
      rows
        .filter((t) => inPeriod(t.date) && t.currency === 'CAD' && countsAsBudgetSpend(t, reimbursableTag, accounts))
        .reduce((sum, t) => sum - t.amount, 0),
    )

  const byId = new Map(all.map((row) => [row.id, row]))
  const lines: CompareLine[] = []
  const line = (kind: LineKind, monarch: Transaction[], td: Transaction[]) =>
    lines.push({ kind, monarch, td, monarchSpend: spendOf(monarch), tdSpend: spendOf(td) })

  // Rows that count in both worlds are the same row on both sides.
  for (const [id, parts] of monarchParts) if (tdParts.has(id)) line('shared', parts, tdParts.get(id)!)

  const monarchOnly = [...monarchParts.keys()].filter((id) => !tdParts.has(id)).map((id) => byId.get(id)!)
  const tdOnly = [...tdParts.keys()].filter((id) => !monarchParts.has(id)).map((id) => byId.get(id)!)
  const pairs = pairFeeds(tdOnly, monarchOnly)
  const claimed = new Set<string>()
  for (const td of tdOnly) {
    const match = pairs.get(td.id)
    if (match) {
      for (const m of match) claimed.add(m.id)
      line('paired', match.flatMap((m) => monarchParts.get(m.id) ?? []), tdParts.get(td.id)!)
    } else line('tdOnly', [], tdParts.get(td.id)!)
  }
  for (const m of monarchOnly) if (!claimed.has(m.id)) line('monarchOnly', monarchParts.get(m.id)!, [])

  // Each line sits on the day it counts in this period (TD's date first).
  const days = new Map<string, CompareDay>()
  for (const l of lines) {
    const dates = [...l.td, ...l.monarch].map((t) => t.date)
    const date = dates.find(inPeriod)
    if (!date) continue
    if (l.kind !== 'shared' && l.monarchSpend === 0 && l.tdSpend === 0 && !hasSpendRow(l, accounts, reimbursableTag)) {
      // Transfers, card payments, income: no part in budget spend either side.
      continue
    }
    const day = days.get(date) ?? { date, monarchSpend: 0, tdSpend: 0, lines: [] }
    day.monarchSpend = round(day.monarchSpend + l.monarchSpend)
    day.tdSpend = round(day.tdSpend + l.tdSpend)
    day.lines.push(l)
    days.set(date, day)
  }
  for (const day of days.values()) day.lines.sort((a, z) => order(a) - order(z))
  return [...days.values()].sort((a, z) => z.date.localeCompare(a.date))
}

/** Does either side have a row that counts as spend at all (e.g. a $0 net)? */
function hasSpendRow(l: CompareLine, accounts: Account[], tag: string): boolean {
  return [...l.monarch, ...l.td].some((t) => countsAsBudgetSpend(t, tag, accounts))
}

/** Lines that make a difference first, then pairs, then shared rows. */
function order(l: CompareLine): number {
  if (l.monarchSpend !== l.tdSpend) return 0
  return l.kind === 'shared' ? 2 : 1
}
