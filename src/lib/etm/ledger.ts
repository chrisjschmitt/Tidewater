import { isInternalCategory } from '../categories'
import type { GroupId } from '../types'
import type { TdCutover } from './config'
import { etmGroupFor } from './groups'
import type { Transaction } from './types'

/**
 * Which rows count. Two feeds can hold the same purchase — Monarch's export
 * and TD's own file — so exactly one of them is the ledger for any account on
 * any day:
 *
 * - before the account's TD cutover date, Monarch (and manual entries) count
 *   and TD rows are a shadow, kept for comparison only;
 * - from the cutover date, TD (and manual entries) count and Monarch rows
 *   become the comparison.
 *
 * With no cutover set anywhere, TD rows never count. The cutover is
 * configuration only, so moving it moves no data and can be undone.
 */
export function cutoverFor(cutover: TdCutover | undefined, accountId: string): string | undefined {
  return cutover?.perAccount[accountId] ?? cutover?.global
}

/**
 * What the switch-over needs to know beyond the dates: which accounts have a
 * TD feed at all (an account with none — a card from another bank — stays on
 * Monarch whatever the global date), and how purchases that straddle the
 * date were settled (see `straddleDecisions`).
 */
export interface LedgerOptions {
  tdAccounts?: Set<string>
  decided?: Map<string, boolean>
  /** Month → last day counted in it (EtmConfig.monthCutoffs). */
  cutoffs?: Record<string, string>
}

/**
 * The day a row counts on in the budget: its own budgetDate if set; else, if
 * its month was closed early and the row falls after the close, the first of
 * the next month; else the bank's date.
 */
export function budgetDateOf(row: Pick<Transaction, 'date' | 'budgetDate'>, cutoffs?: Record<string, string>): string {
  if (row.budgetDate) return row.budgetDate
  const month = row.date.slice(0, 7)
  const cutoff = cutoffs?.[month]
  if (cutoff && cutoff.slice(0, 7) === month && row.date > cutoff) {
    const [y, m] = month.split('-').map(Number)
    return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`
  }
  return row.date
}

export function counts(row: Transaction, cutover: TdCutover | undefined, options: LedgerOptions = {}): boolean {
  if (row.duplicateOf) return false
  if (row.source === 'manual') return true
  const decided = options.decided?.get(row.id)
  if (decided !== undefined) return decided
  const from =
    row.source === 'monarch' && options.tdAccounts && !options.tdAccounts.has(row.accountId)
      ? undefined
      : cutoverFor(cutover, row.accountId)
  if (row.source === 'td') return Boolean(from && row.date >= from)
  return !from || row.date < from
}

/** The accounts that have a TD feed: at least one TD row stored. */
export function tdAccountIds(all: Transaction[]): Set<string> {
  return new Set(all.filter((row) => row.source === 'td').map((row) => row.accountId))
}

const DAY_MS = 86_400_000
const textOf = (row: Transaction) => row.originalStatement.replace(/\s+/g, ' ').trim().toUpperCase()
const cents = (n: number) => Math.round(n * 100)

/**
 * Purchases on either side of an account's switch-over date. Monarch can date
 * a card purchase a day or two away from TD (posting versus transaction), so
 * the same purchase could fall before the date in one feed and after it in the
 * other — counted twice, or not at all. For each such pair, TD's date decides:
 * on or after the switch-over the TD row counts and the Monarch row does not;
 * before it, the other way round.
 */
export function straddleDecisions(all: Transaction[], cutover: TdCutover | undefined): Map<string, boolean> {
  const decided = new Map<string, boolean>()
  if (!cutover) return decided
  const window = (date: string, from: string) => Math.abs(Date.parse(date) - Date.parse(from)) <= 4 * DAY_MS
  const near = all.filter((row) => {
    if (row.source === 'manual') return false
    const from = cutoverFor(cutover, row.accountId)
    return Boolean(from && window(row.date, from))
  })
  const monarch = near.filter((row) => row.source === 'monarch')
  const claimed = new Set<string>()
  for (const td of near.filter((row) => row.source === 'td')) {
    const from = cutoverFor(cutover, td.accountId)!
    const candidates = monarch.filter(
      (m) =>
        !claimed.has(m.id) &&
        m.accountId === td.accountId &&
        textOf(m) === textOf(td) &&
        Math.abs(Date.parse(m.date) - Date.parse(td.date)) <= 3 * DAY_MS,
    )
    let match = candidates.filter((m) => cents(m.amount) === cents(td.amount)).slice(0, 1)
    if (match.length === 0) {
      // A Monarch split: sibling rows on one day whose total is the TD amount.
      for (const m of candidates) {
        const group = candidates.filter((g) => g.date === m.date)
        if (cents(group.reduce((s, g) => s + g.amount, 0)) === cents(td.amount)) {
          match = group
          break
        }
      }
    }
    if (match.length === 0) continue
    const tdCounts = td.date >= from
    decided.set(td.id, tdCounts)
    for (const m of match) {
      claimed.add(m.id)
      decided.set(m.id, !tdCounts)
    }
  }
  return decided
}

/**
 * The ledger: rows that count, with split rows replaced by their parts so a
 * split is never counted twice. Each part keeps the parent's identity fields
 * and gets a derived id (`<id>#1`, `<id>#2`, …).
 */
export function ledgerView(
  all: Transaction[],
  cutover: TdCutover | undefined,
  groups?: Record<string, GroupId>,
  options?: LedgerOptions,
): Transaction[] {
  const settled: LedgerOptions = {
    tdAccounts: options?.tdAccounts ?? tdAccountIds(all),
    decided: options?.decided ?? straddleDecisions(all, cutover),
    ...(options?.cutoffs ? { cutoffs: options.cutoffs } : {}),
  }
  const out: Transaction[] = []
  for (const original of all) {
    if (!counts(original, cutover, settled)) continue
    const effective = budgetDateOf(original, settled.cutoffs)
    const row = effective === original.date ? original : { ...original, date: effective, bankDate: original.date }
    if (!row.split || row.split.length === 0) {
      out.push(row)
      continue
    }
    row.split.forEach((line, index) => {
      out.push({
        ...row,
        id: `${row.id}#${index + 1}`,
        amount: line.amount,
        category: line.category,
        groupId: etmGroupFor(line.category, groups),
        internal: isInternalCategory(line.category),
        tags: line.tags,
        merchant: line.merchant ?? row.merchant,
        notes: line.notes?.trim() ? line.notes : row.notes,
        split: undefined,
        splitOf: { part: index + 1, parts: row.split!.length, parentId: row.id },
      })
    })
  }
  return out
}

/** Rows kept for comparison only: the feed that does not count for its date. */
export function shadowRows(all: Transaction[], cutover: TdCutover | undefined): Transaction[] {
  const options = { tdAccounts: tdAccountIds(all), decided: straddleDecisions(all, cutover) }
  return all.filter((row) => row.source !== 'manual' && !counts(row, cutover, options))
}
