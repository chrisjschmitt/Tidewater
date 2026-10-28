import type { Budget } from '../types'
import { planAmountAt, type PlanHistory } from './planHistory'

/**
 * Why a plan is what it is. Each plan change can carry a note — the
 * assumption behind it — and each category a standing note ("Seasonal:
 * higher Jun–Sep"). Either can name a month to review it by; from that month
 * the Forecast tab lists it under "Assumptions to revisit" until it is
 * confirmed or changed. Kept in expense tracking's encrypted forecast
 * settings, beside the plan history:
 *
 *     gas: { label: 'Gas', standing: { text: 'Winter trips', reviewBy: '2027-04' },
 *            changes: [{ month: '2026-11', text: 'Trailer trips', reviewBy: '2027-04' }] }
 */
export interface PlanNote {
  text: string
  /** `YYYY-MM`: from this month the note is listed to revisit. */
  reviewBy?: string
}

export interface PlanChangeNote extends PlanNote {
  /** The month the change took effect, `YYYY-MM`. */
  month: string
}

export interface CategoryNotes {
  label: string
  standing?: PlanNote
  changes: PlanChangeNote[]
}

export type PlanNotes = Record<string, CategoryNotes>

/** A note typed beside a plan change, before it is saved. */
export interface PlanNoteDraft {
  text: string
  reviewBy?: string
}

/** A plan change from the Forecast tab, with the optional "Why?". */
export interface PlanChangeRequest {
  key: string
  label: string
  month: string
  amount: number
  note?: PlanNoteDraft
}

/** A month where a category's plan amount differs from the month before. */
export interface PlanChange {
  month: string
  from: number
  to: number
  note?: PlanChangeNote
}

/** What the note marker shows for one category in one month. */
export interface PlanStory {
  standing?: PlanNote
  /** The latest change at or before the month: what set this month's amount. */
  change?: PlanChange
  /** Every change, newest first. */
  history: PlanChange[]
}

export interface DueReview {
  key: string
  label: string
  /** The change's month, or undefined for the standing note. */
  month?: string
  note: PlanNote
}

const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)

function shiftMonth(month: string, by: number): string {
  const [year, mm] = month.split('-').map(Number)
  const index = year! * 12 + (mm! - 1) + by
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

const cleanNote = (text: string, reviewBy?: string): PlanNote | undefined => {
  const trimmed = text.trim()
  const review = isMonth(reviewBy) ? reviewBy : undefined
  if (!trimmed && !review) return undefined
  return { text: trimmed, ...(review ? { reviewBy: review } : {}) }
}

function withEntry(notes: PlanNotes | undefined, key: string, entry: CategoryNotes): PlanNotes {
  const next = { ...(notes ?? {}) }
  if (!entry.standing && entry.changes.length === 0) delete next[key]
  else next[key] = entry
  return next
}

/** Set (or, with empty text and no review month, remove) the note on the change made in `month`. */
export function withChangeNote(
  notes: PlanNotes | undefined,
  change: { key: string; label: string; month: string; text: string; reviewBy?: string },
): PlanNotes {
  const current = notes?.[change.key]
  const changes = (current?.changes ?? []).filter((item) => item.month !== change.month)
  const note = cleanNote(change.text, change.reviewBy)
  if (note) changes.push({ month: change.month, ...note })
  changes.sort((a, z) => a.month.localeCompare(z.month))
  return withEntry(notes, change.key, {
    label: change.label,
    ...(current?.standing ? { standing: current.standing } : {}),
    changes,
  })
}

/** Set (or, with empty text and no review month, remove) a category's standing note. */
export function withStandingNote(
  notes: PlanNotes | undefined,
  standing: { key: string; label: string; text: string; reviewBy?: string },
): PlanNotes {
  const current = notes?.[standing.key]
  const note = cleanNote(standing.text, standing.reviewBy)
  return withEntry(notes, standing.key, {
    label: standing.label,
    ...(note ? { standing: note } : {}),
    changes: current?.changes ?? [],
  })
}

/**
 * The changes to a category's plan, oldest first, read from the plan history:
 * every month where the amount differs from the month before. One-month
 * raises show as two changes, the raise and the return.
 */
export function planChanges(
  budget: Budget,
  history: PlanHistory | undefined,
  notes: PlanNotes | undefined,
  key: string,
): PlanChange[] {
  const bounds = new Set((history?.[key]?.eras ?? []).map((era) => era.until))
  for (const note of notes?.[key]?.changes ?? []) bounds.add(note.month)
  const out: PlanChange[] = []
  for (const month of [...bounds].sort()) {
    const from = planAmountAt(budget, history, key, shiftMonth(month, -1))
    const to = planAmountAt(budget, history, key, month)
    const note = notes?.[key]?.changes.find((item) => item.month === month)
    // A noted month with no change in amount still shows, so its note isn't lost.
    if (from === to && !note) continue
    out.push({ month, from, to, ...(note ? { note } : {}) })
  }
  return out
}

export function planStory(
  budget: Budget,
  history: PlanHistory | undefined,
  notes: PlanNotes | undefined,
  key: string,
  month: string,
): PlanStory {
  const changes = planChanges(budget, history, notes, key)
  const change = [...changes].reverse().find((item) => item.month <= month)
  const standing = notes?.[key]?.standing
  return {
    ...(standing ? { standing } : {}),
    ...(change ? { change } : {}),
    history: [...changes].reverse(),
  }
}

/**
 * A change from `month` on replaces any change scheduled after it, so notes
 * on those later changes go with them.
 */
export function withoutNotesAfter(notes: PlanNotes | undefined, key: string, month: string): PlanNotes | undefined {
  const current = notes?.[key]
  if (!current || !current.changes.some((change) => change.month > month)) return notes
  return withEntry(notes, key, { ...current, changes: current.changes.filter((change) => change.month <= month) })
}

/** Whether the marker has anything to show beyond "add a note". */
export const hasNotes = (notes: PlanNotes | undefined, key: string): boolean =>
  Boolean(notes?.[key]?.standing || (notes?.[key]?.changes.length ?? 0) > 0)

/** Notes whose review month has arrived, earliest first. */
export function dueReviews(notes: PlanNotes | undefined, month: string): DueReview[] {
  const out: DueReview[] = []
  for (const [key, entry] of Object.entries(notes ?? {})) {
    if (entry.standing?.reviewBy && entry.standing.reviewBy <= month) {
      out.push({ key, label: entry.label, note: entry.standing })
    }
    for (const change of entry.changes) {
      if (change.reviewBy && change.reviewBy <= month) {
        out.push({ key, label: entry.label, month: change.month, note: change })
      }
    }
  }
  return out.sort((a, z) => a.note.reviewBy!.localeCompare(z.note.reviewBy!) || a.label.localeCompare(z.label))
}

/** "Still right": the note stays; its review moves to `next`, or is cleared. */
export function withReviewed(notes: PlanNotes | undefined, review: DueReview, next?: string): PlanNotes {
  const text = review.note.text
  return review.month
    ? withChangeNote(notes, { key: review.key, label: review.label, month: review.month, text, ...(next ? { reviewBy: next } : {}) })
    : withStandingNote(notes, { key: review.key, label: review.label, text, ...(next ? { reviewBy: next } : {}) })
}

/** Tolerates a damaged record: anything malformed is dropped. */
export function readPlanNotes(stored: unknown): PlanNotes | undefined {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return undefined
  const out: PlanNotes = {}
  for (const [key, raw] of Object.entries(stored as Record<string, unknown>)) {
    const entry = raw as Partial<CategoryNotes> | undefined
    if (!entry || typeof entry.label !== 'string') continue
    const read = (note: unknown): PlanNote | undefined => {
      const n = note as Partial<PlanNote> | undefined
      return n && typeof n.text === 'string' ? cleanNote(n.text, n.reviewBy) : undefined
    }
    const standing = read(entry.standing)
    const changes = Array.isArray(entry.changes)
      ? entry.changes.flatMap((change) => {
          const note = read(change)
          return note && isMonth((change as PlanChangeNote).month) ? [{ month: (change as PlanChangeNote).month, ...note }] : []
        })
      : []
    if (standing || changes.length > 0) out[key] = { label: entry.label, ...(standing ? { standing } : {}), changes }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
