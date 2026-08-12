/**
 * Transaction identity.
 *
 * A Monarch export carries no id, so one is derived from the parts of a row
 * that do not change when the row is re-categorized or re-tagged: when it
 * happened, which account it hit, how much, and what the bank actually wrote.
 * Re-importing an overlapping export therefore recognises rows it has already
 * seen, and only the editable fields get refreshed.
 *
 * The account is the raw Monarch string rather than a local account id, so
 * these ids never depend on the state of the account registry: renaming or
 * rebuilding an account here can not orphan a year of history.
 */

/** 128 bits of SHA-256 — far more than enough to keep a lifetime of rows apart. */
const ID_HEX_CHARS = 32

export interface IdentityParts {
  date: string
  /** The Monarch account string, verbatim. */
  account: string
  amount: number
  originalStatement: string
}

/**
 * Two genuinely identical rows can appear in one export — the same coffee
 * bought twice in a day posts as two indistinguishable lines. The occurrence
 * index keeps them distinct while staying stable across re-exports, since it
 * counts from the top of the file in export order.
 */
export async function transactionId(parts: IdentityParts, occurrence: number): Promise<string> {
  const canonical = [
    parts.date,
    parts.account.trim().toLowerCase(),
    parts.amount.toFixed(2),
    parts.originalStatement.trim().toLowerCase(),
    String(occurrence),
  ].join('\u0000')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, ID_HEX_CHARS)
}

/** Counts repeats of an otherwise identical row within a single file. */
export function occurrenceCounter() {
  const seen = new Map<string, number>()
  return (parts: IdentityParts): number => {
    const key = `${parts.date}|${parts.account}|${parts.amount.toFixed(2)}|${parts.originalStatement}`
    const next = seen.get(key) ?? 0
    seen.set(key, next + 1)
    return next
  }
}
