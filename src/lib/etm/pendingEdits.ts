import { isInternalCategory } from '../categories'
import type { GroupId } from '../types'
import { etmGroupFor } from './groups'
import type { PendingSnapshot } from './pending'
import { settleRow } from './review'
import { statementKey } from './rules/normalize'
import type { SplitLine, Transaction } from './types'

/**
 * What the user decided for a card charge while it was still pending at TD:
 * merchant, comment, category, tags and any split. Kept in the settings
 * (pending rows are rebuilt from each reading, so they have nothing stable of
 * their own) and carried onto the posted row once it arrives.
 */
export interface PendingEdit {
  /** accountId|date|cents|description — the charge as TD listed it. */
  key: string
  accountId: string
  date: string
  description: string
  amount: number
  merchant: string
  notes: string
  category: string
  tags: string[]
  split?: SplitLine[]
  budgetDate?: string
  savedAt: string
}

const DAY_MS = 86_400_000
const cents = (n: number) => Math.round(n * 100)

export const pendingEditKey = (row: { accountId: string; date: string; amount: number; originalStatement: string }): string =>
  `${row.accountId}|${row.date}|${cents(row.amount)}|${row.originalStatement.trim().toUpperCase()}`

/** The edit as saved from the editor: the settled row's own fields. */
export function editFromSettled(settled: Transaction, savedAt: string): PendingEdit {
  return {
    key: pendingEditKey(settled),
    accountId: settled.accountId,
    date: settled.date,
    description: settled.originalStatement,
    amount: settled.amount,
    merchant: settled.merchant,
    notes: settled.notes,
    category: settled.category,
    tags: settled.tags,
    ...(settled.split && settled.split.length > 1 ? { split: settled.split } : {}),
    ...(settled.budgetDate ? { budgetDate: settled.budgetDate } : {}),
    savedAt,
  }
}

/** A pending row shown with the user's edit on it. */
export function withPendingEdit(row: Transaction, edit: PendingEdit, groups?: Record<string, GroupId>): Transaction {
  const next: Transaction = {
    ...row,
    merchant: edit.merchant,
    notes: edit.notes,
    category: edit.category,
    groupId: etmGroupFor(edit.category, groups),
    internal: isInternalCategory(edit.category),
    tags: edit.tags,
    reviewed: true,
  }
  if (edit.split && edit.split.length > 1) next.split = edit.split
  else delete next.split
  if (edit.budgetDate) next.budgetDate = edit.budgetDate
  return next
}

/** The edit's parts, in the edit's own amounts (one part when it isn't split). */
export const editLines = (edit: PendingEdit): SplitLine[] =>
  edit.split && edit.split.length > 1 ? edit.split : [{ amount: edit.amount, category: edit.category, tags: edit.tags }]

/** The parts scaled to a posted amount that differs, the last part taking the rounding. */
export function scaledLines(edit: PendingEdit, amount: number): SplitLine[] {
  const lines = editLines(edit)
  const factor = edit.amount === 0 ? 0 : amount / edit.amount
  let placed = 0
  return lines.map((line, index) => {
    const part = index === lines.length - 1 ? Math.round((amount - placed) * 100) / 100 : Math.round(line.amount * factor * 100) / 100
    placed = Math.round((placed + part) * 100) / 100
    return { ...line, amount: part }
  })
}

/** The posted row with the edit carried over (same amount only). */
export function carriedRow(posted: Transaction, edit: PendingEdit, groups?: Record<string, GroupId>): Transaction {
  const settled = settleRow(posted, { merchant: edit.merchant, notes: edit.notes, lines: editLines(edit) }, groups)
  const next: Transaction = { ...settled, fromPending: edit.date }
  if (edit.budgetDate) next.budgetDate = edit.budgetDate
  return next
}

export type EditOutcome =
  /** Still pending at TD (or its posted copy isn't read in yet). */
  | { kind: 'waiting'; edit: PendingEdit }
  /** Posted for the same amount: carried over without asking. */
  | { kind: 'carry'; edit: PendingEdit; row: Transaction }
  /** Posted for a different amount: offered, the user confirms. */
  | { kind: 'suggest'; edit: PendingEdit; row: Transaction }
  /** Gone from TD's pending list and never posted. */
  | { kind: 'gone'; edit: PendingEdit }
  /** Its posted row was already filed (by the user, or by this carry-over): nothing left to do. */
  | { kind: 'done'; edit: PendingEdit }

/** Rough merchant match for a changed amount: same bank wording, or the same first word. */
const firstWord = (description: string) => statementKey(description).replace(/[^A-Z]/g, ' ').trim().split(/\s+/)[0] ?? ''
const sameMerchant = (a: string, b: string) =>
  statementKey(a) === statementKey(b) || (firstWord(a).length >= 3 && firstWord(a) === firstWord(b))

const TD_FILE = /^TD-transactions-(\d{4}-\d{2}-\d{2})\.csv$/

/**
 * Where each edit stands against the latest pending reading and the posted
 * rows. A posted row is the edit's when it is on the same card, dated from a
 * day before the charge to a week after — the same window pending rows use to
 * drop a charge that has posted.
 */
export function resolvePendingEdits(
  edits: PendingEdit[],
  snapshot: PendingSnapshot | undefined,
  all: Transaction[],
): EditOutcome[] {
  const used = new Set<string>()
  const posted = all.filter((row) => row.source === 'td' && !row.duplicateOf && !row.pending)
  const inWindow = (row: Transaction, edit: PendingEdit) => {
    if (row.accountId !== edit.accountId || used.has(row.id)) return false
    const days = (Date.parse(row.date) - Date.parse(edit.date)) / DAY_MS
    return days >= -1 && days <= 7
  }
  const stillListed = (edit: PendingEdit) =>
    snapshot?.accounts.some(
      (reading) =>
        reading.accountId === edit.accountId &&
        reading.charges.some(
          (c) => c.date === edit.date && cents(c.amount) === cents(edit.amount) && c.description.trim().toUpperCase() === edit.description.trim().toUpperCase(),
        ),
    ) ?? false
  /** The newest download read in for the card, so "never posted" isn't said before its posted rows are in. */
  const newestFeed = (accountId: string) =>
    posted
      .filter((row) => row.accountId === accountId)
      .map((row) => TD_FILE.exec(row.feedFile ?? '')?.[1] ?? '')
      .sort()
      .pop() ?? ''

  // Same-amount matches first, so a changed-amount guess never takes a row an exact match needs.
  const outcomes = new Map<string, EditOutcome>()
  for (const edit of edits) {
    const row = posted.find((r) => inWindow(r, edit) && cents(r.amount) === cents(edit.amount))
    if (!row) continue
    used.add(row.id)
    outcomes.set(edit.key, row.reviewed ? { kind: 'done', edit } : { kind: 'carry', edit, row })
  }
  for (const edit of edits) {
    if (outcomes.has(edit.key)) continue
    if (stillListed(edit)) {
      outcomes.set(edit.key, { kind: 'waiting', edit })
      continue
    }
    const row = posted.find((r) => inWindow(r, edit) && sameMerchant(r.originalStatement, edit.description))
    if (row) {
      used.add(row.id)
      outcomes.set(edit.key, row.reviewed ? { kind: 'done', edit } : { kind: 'suggest', edit, row })
      continue
    }
    const readIn = snapshot ? newestFeed(edit.accountId) >= snapshot.date : false
    outcomes.set(edit.key, readIn ? { kind: 'gone', edit } : { kind: 'waiting', edit })
  }
  return edits.map((edit) => outcomes.get(edit.key)!)
}
