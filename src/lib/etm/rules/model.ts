import { normalizeTag } from '../tags'
import { collapse, statementKey } from './normalize'
import type { Outcome, RuleSettings, SplitShapeLine } from './types'

/**
 * What history says, learned fresh each time from the rows already in the
 * vault: for each statement key, how it has been filed (weighted towards the
 * recent past), what the merchant is called, whether it is split the same way
 * every time, and what an income line usually brings in.
 */

/** One categorized row of history, from whichever feed. */
export interface HistoryRow {
  date: string
  accountId: string
  /** True on a credit card, where a debit is always spending. */
  card: boolean
  statement: string
  merchant: string
  category: string
  tags: string[]
  amount: number
  /** A row split in place (a reviewed TD row); Monarch splits arrive as sibling rows instead. */
  split?: Array<{ amount: number; category: string; tags: string[] }>
}

export interface LearnedOutcome {
  outcome: Omit<Outcome, 'merchant'>
  weight: number
}

export interface SplitTemplate {
  lines: SplitShapeLine[]
}

export interface RuleModel {
  /** Statement key → weighted outcomes. */
  learned: Map<string, LearnedOutcome[]>
  merchants: Map<string, string>
  templates: Map<string, SplitTemplate>
  /** The most recent split of every merchant ever split, offered in review. */
  lastSplits: Map<string, SplitTemplate>
  /**
   * Merchants filed by amount: the same bank text, each exact amount always the
   * same way (two pension deposits on one day, one per person). Key → cents → outcome.
   */
  byAmount: Map<string, Map<number, Omit<Outcome, 'merchant'>>>
  /** Latest amount seen for keys filed as income, to notice a changed deposit. */
  lastIncome: Map<string, number>
  /** How many separate times each merchant appears in history — regulars are not trip spending. */
  seen: Map<string, number>
  /** Categories that history uses, so a keyword never invents one. */
  categories: Set<string>
  /** Categories whose rows are overwhelmingly money in. */
  incomeCategories: Set<string>
  /** Owner tag (normalized) → the category of the same name, e.g. “reimbursable:x personal” → “X personal”. */
  ownerBuckets: Map<string, string>
}

export const INTERNAL_CATEGORIES = new Set(['transfer', 'credit card payment', 'transfers', 'balance adjustment', 'payment'])
export const isInternal = (category: string): boolean => INTERNAL_CATEGORIES.has(category.trim().toLowerCase())

const DAY_MS = 86_400_000
const outcomeKey = (category: string, tags: string[]) => `${category}\u0000${[...tags].sort().join('\u0001')}`

/**
 * History as the user files things now: merged categories renamed, retired
 * tags dropped, owner-tagged rows given their owner's category, card payments
 * named as such. Rows that cannot teach anything honest return null — a card
 * purchase recorded as a transfer, say.
 */
export function cleanLabel(
  row: HistoryRow,
  settings: RuleSettings,
  reimbursableTag: string,
  ownerBuckets: Map<string, string>,
): { category: string; tags: string[] } | null {
  const merge = (category: string) => settings.categoryMerges[category] ?? mergeCaseless(settings.categoryMerges, category) ?? category
  const retired = new Set(settings.retiredTags.map(normalizeTag))
  const tags = row.tags.filter((tag) => tag.trim() && !retired.has(normalizeTag(tag)))
  let category = merge(row.category)
  const upper = collapse(row.statement).toUpperCase()

  if (!isInternal(category)) {
    for (const tag of tags) {
      const owner = ownerBuckets.get(normalizeTag(tag))
      if (owner) category = owner
    }
  }
  if (row.card && row.amount > 0 && /^(PAYMENT|CREDIT CARD PAYMENT)\b/.test(upper)) category = 'Credit Card Payment'
  if (row.card && row.amount < 0 && isInternal(category)) return null
  if (!category || category === 'Uncategorized') return null
  void reimbursableTag
  return { category, tags }
}

function mergeCaseless(merges: Record<string, string>, category: string): string | undefined {
  const wanted = category.trim().toLowerCase()
  for (const [from, to] of Object.entries(merges)) if (from.trim().toLowerCase() === wanted) return to
  return undefined
}

/**
 * Owner buckets are found, not configured: a `Reimbursable: <Name>` tag whose
 * name is also a category in history (case aside) means rows with that tag
 * belong in that category.
 */
export function findOwnerBuckets(rows: HistoryRow[], reimbursableTag: string): Map<string, string> {
  const categories = new Map<string, string>()
  for (const row of rows) categories.set(row.category.trim().toLowerCase(), row.category)
  const prefix = normalizeTag(reimbursableTag)
  const buckets = new Map<string, string>()
  for (const row of rows) {
    for (const tag of row.tags) {
      const normal = normalizeTag(tag)
      if (!normal.startsWith(`${prefix}:`)) continue
      const name = normal.slice(prefix.length + 1)
      const category = categories.get(name)
      if (category) buckets.set(normal, category)
    }
  }
  return buckets
}

export function buildModel(
  rows: HistoryRow[],
  settings: RuleSettings,
  options: { asOf: string; reimbursableTag: string },
): RuleModel {
  const ownerBuckets = findOwnerBuckets(rows, options.reimbursableTag)
  const asOfMs = Date.parse(options.asOf)
  const halfLifeDays = settings.halfLifeMonths * 30
  const weightOf = (date: string) => 0.5 ** (Math.max(0, asOfMs - Date.parse(date)) / DAY_MS / halfLifeDays)

  const learned = new Map<string, Map<string, LearnedOutcome>>()
  const merchantWeights = new Map<string, Map<string, number>>()
  const occurrences = new Map<string, Array<{ date: string; split?: { signature: string; lines: Array<{ category: string; tags: string[]; amount: number }>; total: number } }>>()
  const lastIncome = new Map<string, { date: string; amount: number }>()
  const amountSeen = new Map<string, Map<number, Map<string, { outcome: Omit<Outcome, 'merchant'>; count: number }>>>()
  const categories = new Set<string>()
  const signs = new Map<string, { positive: number; total: number }>()

  // Monarch writes a split as sibling rows sharing day, account and statement.
  const groups = new Map<string, HistoryRow[]>()
  for (const row of rows) {
    if (!row.statement.trim()) continue
    const id = `${row.date}|${row.accountId}|${collapse(row.statement).toUpperCase()}`
    const list = groups.get(id)
    if (list) list.push(row)
    else groups.set(id, [row])
  }

  for (const group of groups.values()) {
    const first = group[0]!
    const key = statementKey(first.statement)
    if (!key) continue
    const weight = weightOf(first.date)
    for (const row of group) {
      const names = merchantWeights.get(key) ?? new Map<string, number>()
      names.set(row.merchant, (names.get(row.merchant) ?? 0) + weight)
      merchantWeights.set(key, names)
    }

    const parts = group.flatMap((row) =>
      row.split && row.split.length > 0
        ? row.split.map((line) => ({ ...row, amount: line.amount, category: line.category, tags: line.tags, split: undefined }))
        : [row],
    )
    const labels = parts.map((row) => ({ row, label: cleanLabel(row, settings, options.reimbursableTag, ownerBuckets) }))
    if (labels.some((item) => !item.label)) continue
    for (const { row, label } of labels) {
      const cents = Math.round(row.amount * 100)
      const forKey = amountSeen.get(key) ?? new Map()
      const forAmount = forKey.get(cents) ?? new Map()
      const ok = outcomeKey(label!.category, label!.tags)
      const seen = forAmount.get(ok) ?? { outcome: { category: label!.category, tags: label!.tags }, count: 0 }
      seen.count++
      forAmount.set(ok, seen)
      forKey.set(cents, forAmount)
      amountSeen.set(key, forKey)
      categories.add(label!.category)
      const sign = signs.get(label!.category) ?? { positive: 0, total: 0 }
      sign.total++
      if (row.amount > 0) sign.positive++
      signs.set(label!.category, sign)
    }

    const distinct = new Set(labels.map(({ label }) => outcomeKey(label!.category, label!.tags)))
    const list = occurrences.get(key) ?? []
    if (distinct.size > 1) {
      const lines = labels.map(({ row, label }) => ({ category: label!.category, tags: label!.tags, amount: row.amount }))
      list.push({
        date: first.date,
        split: {
          signature: [...distinct].sort().join('\u0002'),
          lines,
          total: lines.reduce((sum, line) => sum + line.amount, 0),
        },
      })
    } else {
      list.push({ date: first.date })
      for (const { row, label } of labels) {
        const ok = outcomeKey(label!.category, label!.tags)
        const forKey = learned.get(key) ?? new Map<string, LearnedOutcome>()
        const entry = forKey.get(ok) ?? { outcome: { category: label!.category, tags: label!.tags }, weight: 0 }
        entry.weight += weight
        forKey.set(ok, entry)
        learned.set(key, forKey)
        if (row.amount > 0) {
          const seen = lastIncome.get(key)
          if (!seen || row.date >= seen.date) lastIncome.set(key, { date: row.date, amount: row.amount })
        }
      }
    }
    occurrences.set(key, list)
  }

  const templates = new Map<string, SplitTemplate>()
  const lastSplits = new Map<string, SplitTemplate>()
  for (const [key, list] of occurrences) {
    const ordered = [...list].sort((a, z) => a.date.localeCompare(z.date))
    const lastSplit = [...ordered].reverse().find((item) => item.split)
    if (!lastSplit?.split) continue
    const recent = ordered.slice(-4)
    const same = recent.filter((item) => item.split?.signature === lastSplit.split!.signature)
    // Three of the last four, or every time when the merchant is newer than that.
    const always = recent.length >= 2 && same.length === recent.length
    if (same.length >= 3 || always) templates.set(key, { lines: shapeOf(same.map((item) => item.split!)) })
    lastSplits.set(key, { lines: shapeOf([lastSplit.split]) })
  }

  // Amount rules only where amount explains the category: the merchant has more
  // than one way of filing, and each repeated amount always went the same way.
  const byAmount = new Map<string, Map<number, Omit<Outcome, 'merchant'>>>()
  for (const [key, amounts] of amountSeen) {
    const outcomes = new Set([...amounts.values()].flatMap((m) => [...m.keys()]))
    if (outcomes.size < 2) continue
    const rules = new Map<number, Omit<Outcome, 'merchant'>>()
    for (const [cents, forAmount] of amounts) {
      const entries = [...forAmount.values()]
      const total = entries.reduce((sum, e) => sum + e.count, 0)
      const best = entries.sort((a, z) => z.count - a.count)[0]!
      if (total >= 2 && best.count / total >= 0.8) rules.set(cents, best.outcome)
    }
    if (rules.size > 0) byAmount.set(key, rules)
  }

  const incomeCategories = new Set<string>()
  for (const [category, sign] of signs) if (sign.total >= 2 && sign.positive / sign.total >= 0.8) incomeCategories.add(category)

  return {
    learned: new Map([...learned].map(([key, map]) => [key, [...map.values()].sort((a, z) => z.weight - a.weight)])),
    merchants: new Map([...merchantWeights].map(([key, names]) => [key, [...names].sort((a, z) => z[1] - a[1])[0]![0]])),
    templates,
    lastSplits,
    byAmount,
    seen: new Map([...occurrences].map(([key, list]) => [key, list.length])),
    lastIncome: new Map([...lastIncome].map(([key, value]) => [key, value.amount])),
    categories,
    incomeCategories,
    ownerBuckets,
  }
}

/** Fixed amounts when the recent splits used the same figures, else each line's share of the total. */
function shapeOf(splits: Array<{ lines: Array<{ category: string; tags: string[]; amount: number }>; total: number }>): SplitShapeLine[] {
  const latest = splits[splits.length - 1]!
  const sortLines = (lines: typeof latest.lines) =>
    [...lines].sort((a, z) => a.category.localeCompare(z.category) || a.amount - z.amount)
  const fixed = splits.length >= 2 &&
    splits.slice(-2).every((split, _, pair) =>
      JSON.stringify(sortLines(split.lines).map((l) => l.amount)) === JSON.stringify(sortLines(pair[0]!.lines).map((l) => l.amount)),
    )
  return sortLines(latest.lines).map((line) =>
    fixed
      ? { category: line.category, tags: line.tags, amount: Math.abs(line.amount) }
      : { category: line.category, tags: line.tags, share: latest.total === 0 ? 0 : line.amount / latest.total },
  )
}
