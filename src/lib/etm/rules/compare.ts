import type { Account, Transaction } from '../types'
import { cleanLabel, type RuleModel } from './model'
import { collapse } from './normalize'
import type { RuleSettings } from './types'

/**
 * The parallel run's yardstick: each TD row beside the Monarch row (or split
 * rows) for the same purchase, and whether the two were filed the same way.
 *
 * A pair is the same account, the same bank text, amounts that agree (a
 * Monarch split counts as its total), and dates no more than three days apart
 * — Monarch sometimes dates a card purchase by when it posted.
 */

export interface FeedPair {
  td: Transaction
  monarch: Transaction[]
  agrees: boolean
  /** Category (or split categories) on each side, as compared. */
  tdCategories: string[]
  monarchCategories: string[]
}

export interface FeedComparison {
  pairs: FeedPair[]
  /** TD rows Monarch has nothing for — often a purchase Monarch missed. */
  tdOnly: Transaction[]
  /** Monarch rows TD has nothing for — the Costco card, or a period not downloaded. */
  monarchOnly: Transaction[]
}

const DAY_MS = 86_400_000
const near = (a: string, z: string) => Math.abs(Date.parse(a) - Date.parse(z)) <= 3 * DAY_MS
const cents = (n: number) => Math.round(n * 100)
const textOf = (row: Transaction) => collapse(row.originalStatement).toUpperCase()

export function matchFeeds(
  td: Transaction[],
  monarch: Transaction[],
  options: { accounts: Account[]; model: RuleModel; settings: RuleSettings; reimbursableTag: string },
): FeedComparison {
  const cards = new Set(options.accounts.filter((a) => a.kind === 'credit').map((a) => a.id))
  const claimed = new Set<string>()

  // Monarch's split rows travel together.
  const groups = new Map<string, Transaction[]>()
  for (const row of monarch) {
    if (!row.originalStatement) continue
    const id = `${row.accountId}|${row.date}|${textOf(row)}`
    groups.set(id, [...(groups.get(id) ?? []), row])
  }

  const pairs: FeedPair[] = []
  const tdOnly: Transaction[] = []
  for (const row of [...td].sort((a, z) => a.date.localeCompare(z.date))) {
    const text = textOf(row)
    const candidates = monarch
      .filter((m) => !claimed.has(m.id) && m.accountId === row.accountId && textOf(m) === text && near(m.date, row.date))
      .sort((a, z) => Math.abs(Date.parse(a.date) - Date.parse(row.date)) - Math.abs(Date.parse(z.date) - Date.parse(row.date)))

    // A single row of the same amount first; then a whole split group whose total matches.
    let match: Transaction[] | undefined
    const single = candidates.find((m) => cents(m.amount) === cents(row.amount))
    if (single) match = [single]
    else {
      for (const m of candidates) {
        const group = (groups.get(`${m.accountId}|${m.date}|${text}`) ?? []).filter((g) => !claimed.has(g.id))
        if (group.length > 1 && cents(group.reduce((s, g) => s + g.amount, 0)) === cents(row.amount)) {
          match = group
          break
        }
      }
    }
    if (!match) {
      tdOnly.push(row)
      continue
    }
    for (const m of match) claimed.add(m.id)

    const card = cards.has(row.accountId)
    const label = (r: Transaction) =>
      cleanLabel(
        { date: r.date, accountId: r.accountId, card, statement: r.originalStatement, merchant: r.merchant, category: r.category, tags: r.tags, amount: r.amount },
        options.settings,
        options.reimbursableTag,
        options.model.ownerBuckets,
      )?.category ?? r.category
    const tdCategories = [...new Set((row.split ?? [row]).map((line) => line.category))].sort()
    const monarchCategories = [...new Set(match.map(label))].sort()
    const bank = (c: string) => (!card && c === 'Credit Card Payment' ? 'Transfer' : c)
    pairs.push({
      td: row,
      monarch: match,
      tdCategories,
      monarchCategories,
      agrees: tdCategories.map(bank).join('|') === monarchCategories.map(bank).join('|'),
    })
  }

  const monarchOnly = monarch.filter((m) => !claimed.has(m.id))
  return { pairs, tdOnly, monarchOnly }
}

/** Agreement by account and month, for the readiness figure beside each cutover. */
export function agreementByMonth(pairs: FeedPair[]): Map<string, { agree: number; total: number }> {
  const out = new Map<string, { agree: number; total: number }>()
  for (const pair of pairs) {
    const key = `${pair.td.accountId}|${pair.td.date.slice(0, 7)}`
    const entry = out.get(key) ?? { agree: 0, total: 0 }
    entry.total++
    if (pair.agrees) entry.agree++
    out.set(key, entry)
  }
  return out
}
