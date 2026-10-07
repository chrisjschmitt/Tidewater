import { isInternalCategory } from '../../categories'
import type { GroupId } from '../../types'
import { etmGroupFor } from '../groups'
import type { ImportPlan, TdCategorizer, TdOutcome } from '../importer'
import { uid } from '../../format'
import { monthOf, type Account, type SplitLine, type Transaction } from '../types'
import { categorize, type RuleContext } from './engine'
import type { HistoryRow } from './model'
import { displayName, statementKey } from './normalize'
import type { Outcome, RuleResult } from './types'

/**
 * Where the engine meets the stored rows: history in, TD outcomes out, and the
 * plan that re-applies the rules to TD rows nobody has confirmed yet.
 */

/**
 * What history the engine learns from: every Monarch row, and every TD row the
 * user has confirmed. Unconfirmed TD rows are the engine's own guesses, so
 * learning from them would only teach it to agree with itself.
 */
export function historyRows(all: Transaction[], accounts: Account[]): HistoryRow[] {
  const cards = new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.id))
  return all
    .filter((row) => row.originalStatement && (row.source === 'monarch' || (row.source === 'td' && row.reviewed)))
    .map((row) => ({
      date: row.date,
      accountId: row.accountId,
      card: cards.has(row.accountId),
      statement: row.originalStatement,
      merchant: row.merchant,
      category: row.category,
      tags: row.tags,
      amount: row.amount,
      ...(row.split ? { split: row.split.map((line) => ({ amount: line.amount, category: line.category, tags: line.tags })) } : {}),
    }))
}

const toLines = (outcome: Outcome): SplitLine[] | undefined =>
  outcome.split?.map((line) => ({ amount: line.amount ?? 0, category: line.category, tags: line.tags, ...(line.notes ? { notes: line.notes } : {}) }))

const suggestionOf = (outcome: Outcome) => ({
  merchant: outcome.merchant,
  category: outcome.category,
  tags: outcome.tags,
  ...(outcome.split ? { split: toLines(outcome) } : {}),
})

export function toTdOutcome(result: RuleResult, fallbackMerchant: string): TdOutcome {
  const prediction = {
    layer: result.layer,
    confidence: result.confidence,
    reviewReasons: result.reasons,
    suggestions: result.suggestions.map(suggestionOf),
  }
  if (!result.outcome) {
    return {
      merchant: result.suggestions[0]?.merchant ?? fallbackMerchant,
      category: 'Uncategorized',
      tags: [],
      prediction,
    }
  }
  const split = toLines(result.outcome)
  return {
    merchant: result.outcome.merchant,
    category: result.outcome.category,
    tags: result.outcome.tags,
    ...(split ? { split } : {}),
    ...(result.outcome.notes ? { notes: result.outcome.notes } : {}),
    prediction,
  }
}

/** The importer's hook: each TD row through the engine. */
export function rulesCategorizer(ctx: RuleContext): TdCategorizer {
  return (row, account) =>
    toTdOutcome(categorize({ date: row.date, description: row.description, amount: row.amount, account }, ctx), displayName(row.description))
}

/**
 * Re-running the rules over TD rows not yet confirmed, as an undoable batch.
 * Confirmed rows are the user's word and are never touched.
 */
export function reapplyPlan(
  all: Transaction[],
  accounts: Account[],
  ctx: RuleContext,
  groups?: Record<string, GroupId>,
  onlyKey?: string,
): ImportPlan {
  const batchId = uid('batch')
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const updated: ImportPlan['updated'] = []
  const months = new Set<string>()
  for (const row of all) {
    if (row.source !== 'td' || row.reviewed) continue
    if (onlyKey && statementKey(row.originalStatement) !== onlyKey) continue
    const account = byId.get(row.accountId)
    if (!account) continue
    const outcome = toTdOutcome(
      categorize({ date: row.date, description: row.originalStatement, amount: row.amount, account }, ctx),
      row.merchant === row.originalStatement ? displayName(row.originalStatement) : row.merchant,
    )
    const next: Transaction = {
      ...row,
      merchant: outcome.merchant,
      category: outcome.category,
      groupId: etmGroupFor(outcome.category, groups),
      internal: isInternalCategory(outcome.category),
      tags: outcome.tags,
      // A rule's comment fills an empty one; it never overwrites what was written.
      notes: row.notes || outcome.notes || '',
      prediction: outcome.prediction,
      split: outcome.split,
    }
    if (!next.split) delete next.split
    if (sameOutcome(row, next)) continue
    updated.push({ next, previous: row })
    months.add(monthOf(row.date))
  }
  const dates = updated.map((u) => u.next.date).sort()
  return {
    batchId,
    fileName: onlyKey ? `Taught: ${onlyKey} (${updated.length} TD rows)` : `Rules applied to ${updated.length} TD rows`,
    rowsRead: updated.length,
    skippedRows: 0,
    added: [],
    updated,
    unchanged: 0,
    unmatched: [],
    internal: updated.filter((u) => u.next.internal).length,
    firstDate: dates[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    months: [...months].sort(),
  }
}

function sameOutcome(a: Transaction, z: Transaction): boolean {
  return (
    a.category === z.category &&
    a.merchant === z.merchant &&
    a.tags.join('\u0000') === z.tags.join('\u0000') &&
    a.notes === z.notes &&
    JSON.stringify(a.split ?? null) === JSON.stringify(z.split ?? null) &&
    JSON.stringify(a.prediction?.reviewReasons ?? []) === JSON.stringify(z.prediction?.reviewReasons ?? [])
  )
}
