/**
 * How long the expense vault stays open. Two limits:
 * - **Idle:** 15 minutes without a tap, click, key or scroll in Tidewater.
 *   The in-memory key is dropped, and so is any key kept for "Stay unlocked".
 * - **Stay unlocked:** a remembered key is used for 12 hours at most from the
 *   moment it was saved, then it is deleted, so an older copy of the browser's
 *   files (a Time Machine backup, a copied profile) stops carrying a working key.
 */
export const IDLE_LOCK_MS = 15 * 60_000
export const REMEMBER_MS = 12 * 60 * 60_000

const LAST_ACTIVE = 'tidewater.etm.lastActive'

/** Whether a remembered key may still be used. A missing time counts as too old. */
export function rememberedStillValid(
  rememberedAt: string | undefined,
  lastActive: string | undefined,
  now = Date.now(),
): boolean {
  const saved = rememberedAt ? Date.parse(rememberedAt) : NaN
  if (!Number.isFinite(saved) || now - saved >= REMEMBER_MS || saved > now + 60_000) return false
  // Closed and reopened: idle time counts from the last use, which may be after the save.
  const active = lastActive ? Date.parse(lastActive) : NaN
  if (Number.isFinite(active) && now - active >= IDLE_LOCK_MS) return false
  return true
}

/** Whether the open vault has been idle long enough to lock. */
export const idleExpired = (lastActivityMs: number, now = Date.now()): boolean => now - lastActivityMs >= IDLE_LOCK_MS

export function readLastActive(): string | undefined {
  try {
    return localStorage.getItem(LAST_ACTIVE) ?? undefined
  } catch {
    return undefined
  }
}

export function writeLastActive(at = new Date()): void {
  try {
    localStorage.setItem(LAST_ACTIVE, at.toISOString())
  } catch {
    // A private window: the idle limit still applies while the page is open.
  }
}

export function clearLastActive(): void {
  try {
    localStorage.removeItem(LAST_ACTIVE)
  } catch {
    // Nothing kept, nothing to clear.
  }
}
