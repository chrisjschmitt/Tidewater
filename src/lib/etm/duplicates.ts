import type { Transaction } from './types'

/**
 * TD rows that may be the same purchase twice. A card charge can change
 * between downloads — its date (pending → posted), or its amount (a tip added
 * to a restaurant bill, a hotel deposit settled) — and then arrives again
 * under a new identity. Two rows are flagged when they share an account and
 * bank text, are dated within three days, have amounts within a quarter of
 * each other, and came from different downloads. Identical charges in one
 * download (two coffees in a day) are never flagged.
 */
export interface DuplicatePair {
  key: string
  a: Transaction
  z: Transaction
  sameAmount: boolean
  /** 'hand': a hand-entered row and an imported one (Monarch or TD) — the same purchase entered twice. */
  kind?: 'feeds' | 'hand'
}

const DAY_MS = 86_400_000
const textOf = (row: Transaction) => row.originalStatement.replace(/\s+/g, ' ').trim().toUpperCase()
export const pairKey = (a: string, z: string): string => [a, z].sort().join('|')

export function findPossibleDuplicates(
  rows: Transaction[],
  notDuplicates: string[] = [],
  /** Ids of rows that count now (the ledger). Hand-entered rows are only paired with imported rows that count. */
  counting?: Set<string>,
): DuplicatePair[] {
  const cleared = new Set(notDuplicates)
  const td = rows.filter((row) => row.source === 'td' && !row.duplicateOf && row.originalStatement)
  const groups = new Map<string, Transaction[]>()
  for (const row of td) {
    const key = `${row.accountId}|${textOf(row)}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const pairs: DuplicatePair[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, z) => a.date.localeCompare(z.date))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!
        const z = sorted[j]!
        if (Date.parse(z.date) - Date.parse(a.date) > 3 * DAY_MS) break
        if ((a.feedFile ?? a.importBatchId) === (z.feedFile ?? z.importBatchId)) continue
        if (Math.sign(a.amount) !== Math.sign(z.amount)) continue
        const larger = Math.max(Math.abs(a.amount), Math.abs(z.amount))
        if (larger === 0 || Math.abs(Math.abs(a.amount) - Math.abs(z.amount)) / larger > 0.25) continue
        const key = pairKey(a.id, z.id)
        if (cleared.has(key)) continue
        pairs.push({ key, a, z, sameAmount: Math.round(a.amount * 100) === Math.round(z.amount * 100) })
      }
    }
  }
  pairs.push(...handEnteredTwice(rows, cleared, counting))
  return pairs.sort((p, q) => q.z.date.localeCompare(p.z.date))
}

/**
 * A purchase entered by hand that an import also brought in — say a Costco
 * card charge typed in while Monarch still imports that card. Hand-entered
 * rows always count, so both would. Matched on account and exact amount,
 * within three days; the bank text is not compared, since a typed merchant
 * rarely matches it. The hand-entered row is `a`.
 */
function handEnteredTwice(rows: Transaction[], cleared: Set<string>, counting?: Set<string>): DuplicatePair[] {
  // Only rows that count: before the switch-over a TD row is a shadow, so a
  // hand-entered row beside it is not counted twice and must not be dropped.
  const imported = rows.filter(
    (row) => (row.source === 'monarch' || row.source === 'td') && !row.duplicateOf && (!counting || counting.has(row.id)),
  )
  const pairs: DuplicatePair[] = []
  for (const manual of rows) {
    if (manual.source !== 'manual' || manual.duplicateOf) continue
    const cents = Math.round(manual.amount * 100)
    for (const other of imported) {
      if (other.accountId !== manual.accountId || Math.round(other.amount * 100) !== cents) continue
      if (Math.abs(Date.parse(other.date) - Date.parse(manual.date)) > 3 * DAY_MS) continue
      const key = pairKey(manual.id, other.id)
      if (cleared.has(key)) continue
      pairs.push({ key, a: manual, z: other, sameAmount: true, kind: 'hand' })
    }
  }
  return pairs
}
