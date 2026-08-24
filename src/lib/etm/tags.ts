import type { Transaction } from './types'
import { DEFAULT_CONFIG } from './config'

export const NO_BUCKET = 'No bucket'

/**
 * Family matching: case, spacing, and extra spaces around `:` are ignored.
 * `Reimbursable` and `Reimbursable: Healthcare Account` are the same family.
 */
export const normalizeTag = (tag: string): string =>
  tag.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*:\s*/g, ':')

export const isFamilyTag = (tag: string, parent: string): boolean => {
  const t = normalizeTag(tag)
  const p = normalizeTag(parent)
  if (!t || !p) return false
  return t === p || t.startsWith(`${p}:`)
}

export const isReimbursableFamily = (tags: string[], parent: string): boolean =>
  tags.some((tag) => isFamilyTag(tag, parent))

/** Matched case-insensitively. The parent tag is not required beside a sub-tag. */
export const isReimbursable = (transaction: Transaction, parent: string): boolean =>
  isReimbursableFamily(transaction.tags, parent)

/**
 * Name after `parent:`, empty string if this is the parent itself,
 * null if the tag is not in the family.
 */
export function familySuffix(tag: string, parent: string): string | null {
  const t = normalizeTag(tag)
  const p = normalizeTag(parent)
  if (!t || !p) return null
  if (t === p) return ''
  if (!t.startsWith(`${p}:`)) return null
  const colon = tag.indexOf(':')
  return colon === -1 ? '' : tag.slice(colon + 1).trim().replace(/\s+/g, ' ')
}

/** In the family, but no `Parent: …` sub-tag — leftover generic tagging. */
export function isParentOnlyReimbursable(
  tags: string[],
  parent: string = DEFAULT_CONFIG.reimbursableTag,
): boolean {
  if (!isReimbursableFamily(tags, parent)) return false
  return !tags.some((tag) => {
    const suffix = familySuffix(tag, parent)
    return suffix !== null && suffix !== ''
  })
}

/**
 * A row's bucket is the name after the colon, plus any other tags.
 * The generic parent is dropped so `Reimbursable: Healthcare Account` and
 * the older `Reimbursable` + `Healthcare Account` land in the same bucket.
 * Several names are joined rather than counted under each, so the buckets
 * always sum to the reimbursable total and the tie-out holds.
 */
export function bucketOf(transaction: Transaction, parent: string): string[] {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const tag of transaction.tags) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    const suffix = familySuffix(trimmed, parent)
    const piece = suffix === null ? trimmed : suffix
    if (!piece) continue
    const key = normalizeTag(piece)
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(piece)
  }
  return parts.sort((a, z) => a.localeCompare(z))
}

export const bucketLabel = (tags: string[]): string =>
  tags.length === 0 ? NO_BUCKET : tags.join(' + ')

/** Chip on the transactions table: the bucket name, or the generic parent if none. */
export function reimbursableChip(transaction: Transaction, parent: string): string | null {
  if (!isReimbursable(transaction, parent)) return null
  const label = bucketLabel(bucketOf(transaction, parent))
  return label === NO_BUCKET ? parent : label
}
