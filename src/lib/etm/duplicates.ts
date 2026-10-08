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
}

const DAY_MS = 86_400_000
const textOf = (row: Transaction) => row.originalStatement.replace(/\s+/g, ' ').trim().toUpperCase()
export const pairKey = (a: string, z: string): string => [a, z].sort().join('|')

export function findPossibleDuplicates(rows: Transaction[], notDuplicates: string[] = []): DuplicatePair[] {
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
  return pairs.sort((p, q) => q.z.date.localeCompare(p.z.date))
}
