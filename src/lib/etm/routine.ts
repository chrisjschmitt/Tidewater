import type { ImportBatch, Transaction } from './types'

/**
 * The weekly check-in's steps and where each one stands. Pure, so the states
 * can be checked without a browser; the Weekly tab and its badge read them.
 *
 * "This week" runs from the last time the check-in was marked done on this
 * device (or the last seven days, before it ever was).
 */

export type StepState = 'done' | 'needs' | 'notNeeded'

/** A TD row still waiting for a person: uncategorized, or flagged by the rules. */
export const needsLook = (row: Transaction): boolean =>
  !row.reviewed &&
  (row.category === 'Uncategorized' || row.prediction?.layer === 'review' || (row.prediction?.reviewReasons.length ?? 0) > 0)

const TD_FILE = /^TD-transactions-(\d{4}-\d{2}-\d{2})\.csv$/

/** The day of the newest TD file read, from import batches and the pending reading. */
export function latestTdRead(batches: ImportBatch[], pendingDate?: string): string | undefined {
  const dates = batches
    .map((batch) => batch.fileName.match(TD_FILE)?.[1])
    .filter((d): d is string => Boolean(d))
  if (pendingDate) dates.push(pendingDate)
  return dates.sort().at(-1)
}

/** Whether Monarch is still being imported: a Monarch export brought in within three weeks. */
export function monarchInUse(batches: ImportBatch[], today: string): boolean {
  const since = shiftDays(today, -21)
  return batches.some((batch) => !TD_FILE.test(batch.fileName) && /\.csv$/i.test(batch.fileName) && batch.importedAt.slice(0, 10) >= since)
}

export interface WeeklyInput {
  /** YYYY-MM-DD. */
  today: string
  /** YYYY-MM-DD the check-in was last marked done here. */
  lastDone?: string
  batches: ImportBatch[]
  pendingDate?: string
  /** TD rows (duplicates excluded). */
  tdRows: Transaction[]
  duplicates: number
  /** Edits of pending charges that need you: posted for another amount, or never posted. */
  pendingEditsToSee?: number
  /** ISO time of the last backup on this device. */
  lastBackup?: string
  /** ISO time the data here last changed. */
  changedAt?: string
}

export interface WeeklySteps {
  /** Start of this week's check-in, YYYY-MM-DD. */
  since: string
  read: StepState
  duplicates: StepState
  file: StepState
  /** Rows needing a look in the months the check-in covers. */
  toFile: number
  compare: StepState
  backup: StepState
  /** How many steps need you — the tab's badge. */
  needCount: number
}

const shiftDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const previousMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`
}

export function weeklySteps(input: WeeklyInput): WeeklySteps {
  const since = input.lastDone && input.lastDone <= input.today ? input.lastDone : shiftDays(input.today, -6)
  const latest = latestTdRead(input.batches, input.pendingDate)
  const read: StepState = latest && latest >= since ? 'done' : 'needs'

  // This month and last: last month's stragglers are filed before it closes.
  const month = input.today.slice(0, 7)
  const months = new Set([month, previousMonth(month)])
  const toFile =
    input.tdRows.filter((row) => months.has(row.date.slice(0, 7)) && needsLook(row)).length + (input.pendingEditsToSee ?? 0)
  const file: StepState = toFile > 0 ? 'needs' : 'done'

  const duplicates: StepState = input.duplicates > 0 ? 'needs' : 'notNeeded'

  const compare: StepState = !monarchInUse(input.batches, input.today)
    ? 'notNeeded'
    : input.batches.some((b) => !TD_FILE.test(b.fileName) && /\.csv$/i.test(b.fileName) && b.importedAt.slice(0, 10) >= since)
      ? 'done'
      : 'needs'

  const backup: StepState =
    input.lastBackup && (!input.changedAt || input.lastBackup >= input.changedAt) ? 'done' : 'needs'

  const needCount = [read, duplicates, file, compare, backup].filter((s) => s === 'needs').length
  return { since, read, duplicates, file, toFile, compare, backup, needCount }
}

const DONE_KEY = 'tidewater.etm.weeklyDone'

/** When the check-in was last marked done on this device (local only, never synced). */
export function readWeeklyDone(): string | undefined {
  try {
    return localStorage.getItem(DONE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function writeWeeklyDone(date: string): void {
  try {
    localStorage.setItem(DONE_KEY, date)
  } catch {
    /* private window: the check-in simply isn't remembered */
  }
}
