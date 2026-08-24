import { isInternalCategory, looksLikeIncome } from '../categories'
import {
  isParentOnlyReimbursable,
  isReimbursableFamily,
  normalizeTag,
} from '../etm/tags'
import type { Transaction } from '../etm/types'
import type { Assignment, ForecastConfig } from './types'

export { isParentOnlyReimbursable, isReimbursableFamily, normalizeTag }

export const DEFAULT_REIMBURSABLE_PARENT = 'Reimbursable'

/** Category pairing, same rule ETM uses for plan vs actual. */
export const nameKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ')

export const hasMatchingTag = (tags: string[], wanted: string[]): boolean => {
  const needles = wanted.map(normalizeTag)
  return tags.some((tag) => needles.includes(normalizeTag(tag)))
}

/**
 * A reimbursable sub-tag counts as household spend only when it is on the
 * allow-list. The parent tag alone is never enough.
 */
export const hasAllowListedSubtag = (
  tags: string[],
  allowList: string[],
  parent: string,
): boolean => {
  const p = normalizeTag(parent)
  const allowed = new Set(allowList.map(normalizeTag))
  return tags.some((tag) => {
    const t = normalizeTag(tag)
    if (!t.startsWith(`${p}:`)) return false
    return allowed.has(t)
  })
}

/**
 * Signed spend so a refund nets inside its category: spending is positive,
 * a refund is negative. Matches ETM's `spend = −net`.
 */
export const signedSpend = (amount: number): number => -amount

export function assignSeries(
  transaction: Transaction,
  config: ForecastConfig,
  parentTag: string,
): Assignment {
  if (transaction.internal || isInternalCategory(transaction.category)) return 'dropped'
  if (looksLikeIncome(transaction.category)) return 'dropped'
  // Vacation wins over the allow-list so trip spend cannot leak into groceries.
  if (hasMatchingTag(transaction.tags, config.vacationTags)) return 'vacation'
  if (isReimbursableFamily(transaction.tags, parentTag)) {
    return hasAllowListedSubtag(transaction.tags, config.reimbursableAllowList, parentTag)
      ? 'household'
      : 'excluded'
  }
  return 'household'
}

export interface UniverseSplit {
  household: Transaction[]
  vacation: Transaction[]
  excluded: Transaction[]
  dropped: Transaction[]
}

export function splitUniverse(
  transactions: Transaction[],
  config: ForecastConfig,
  parentTag: string = DEFAULT_REIMBURSABLE_PARENT,
): UniverseSplit {
  const split: UniverseSplit = { household: [], vacation: [], excluded: [], dropped: [] }
  for (const transaction of transactions) {
    split[assignSeries(transaction, config, parentTag)].push(transaction)
  }
  return split
}

/** Canonical spelling for checklists: one space after the colon. */
export const displayTag = (tag: string): string => tag.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/, ': ')

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const trimmed = displayTag(tag)
    const key = normalizeTag(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out.sort((a, z) => a.localeCompare(z))
}

/**
 * `Reimbursable: …` sub-tags that actually appear in the vault. The parent
 * tag alone is not a sub-tag.
 */
export function appearedSubtags(
  transactions: Transaction[],
  parent: string = DEFAULT_REIMBURSABLE_PARENT,
): string[] {
  const prefix = `${normalizeTag(parent)}:`
  const found: string[] = []
  for (const transaction of transactions) {
    for (const tag of transaction.tags) {
      if (normalizeTag(tag).startsWith(prefix)) found.push(tag)
    }
  }
  return uniqueTags(found)
}

/** Household checklist: vault sub-tags and current selections, minus vacation. */
export function householdTagOptions(
  appeared: string[],
  allowList: string[],
  vacationTags: string[],
): string[] {
  const vacation = new Set(vacationTags.map(normalizeTag))
  return uniqueTags([...appeared, ...allowList]).filter((tag) => !vacation.has(normalizeTag(tag)))
}

/** Vacation checklist: vault sub-tags plus whatever is already chosen. */
export function vacationTagOptions(appeared: string[], vacationTags: string[]): string[] {
  return uniqueTags([...appeared, ...vacationTags])
}

/**
 * Turn a typed value into a family sub-tag. A bare name is prefixed with the
 * parent; a full `Parent: Name` is kept.
 */
export function completeSubtag(raw: string, parent: string = DEFAULT_REIMBURSABLE_PARENT): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  if (normalizeTag(trimmed) === normalizeTag(parent)) return ''
  if (trimmed.includes(':')) return displayTag(trimmed)
  return displayTag(`${parent}: ${trimmed}`)
}

export function tagSelected(list: string[], tag: string): boolean {
  const key = normalizeTag(tag)
  return list.some((item) => normalizeTag(item) === key)
}

/** Checking a household tag takes it off the vacation list, and the reverse. */
export function withAllowListedTag(
  config: ForecastConfig,
  tag: string,
  included: boolean,
  parent: string = DEFAULT_REIMBURSABLE_PARENT,
): ForecastConfig {
  const completed = completeSubtag(tag, parent)
  if (!completed) return config
  const key = normalizeTag(completed)
  const reimbursableAllowList = included
    ? uniqueTags([...config.reimbursableAllowList, completed])
    : config.reimbursableAllowList.filter((item) => normalizeTag(item) !== key)
  const vacationTags = included
    ? config.vacationTags.filter((item) => normalizeTag(item) !== key)
    : config.vacationTags
  return { ...config, reimbursableAllowList, vacationTags }
}

export function withVacationTag(
  config: ForecastConfig,
  tag: string,
  included: boolean,
  parent: string = DEFAULT_REIMBURSABLE_PARENT,
): ForecastConfig {
  const completed = completeSubtag(tag, parent)
  if (!completed) return config
  const key = normalizeTag(completed)
  const vacationTags = included
    ? uniqueTags([...config.vacationTags, completed])
    : config.vacationTags.filter((item) => normalizeTag(item) !== key)
  const reimbursableAllowList = included
    ? config.reimbursableAllowList.filter((item) => normalizeTag(item) !== key)
    : config.reimbursableAllowList
  return { ...config, reimbursableAllowList, vacationTags }
}

export const isUncategorizedCategory = (category: string): boolean =>
  !category.trim() || /^uncategorized$/i.test(category.trim())

export interface TaggingGaps {
  uncategorizedHousehold: number
  parentOnlyReimbursable: number
}

/**
 * Companion counts for the Forecast tab — not a second tidy workflow.
 * Household Uncategorized (no reimbursable family tag) and reimbursable
 * rows that still carry only the generic parent tag.
 */
export function taggingGaps(
  transactions: Transaction[],
  config: ForecastConfig,
  parent: string = DEFAULT_REIMBURSABLE_PARENT,
): TaggingGaps {
  let uncategorizedHousehold = 0
  let parentOnlyReimbursable = 0
  for (const transaction of transactions) {
    const series = assignSeries(transaction, config, parent)
    if (series === 'dropped') continue
    if (isParentOnlyReimbursable(transaction.tags, parent)) {
      parentOnlyReimbursable++
      continue
    }
    if (
      series === 'household' &&
      isUncategorizedCategory(transaction.category) &&
      !isReimbursableFamily(transaction.tags, parent)
    ) {
      uncategorizedHousehold++
    }
  }
  return { uncategorizedHousehold, parentOnlyReimbursable }
}
