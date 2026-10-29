/**
 * Which copy of the data is newest. Each browser keeps its own vault — the
 * Mac imports, the iPad is restored from backups — so each one records, in
 * plain text beside the vault, when its data last changed and on which
 * device, and how far its TD and Monarch rows reach. Backups carry that
 * record; restoring one carries it over. Comparing two records says whether a
 * backup holds newer data than this device.
 *
 * Dates and a device name only: no amounts, no merchants, no accounts.
 */
export interface Freshness {
  /** When the data last changed, ISO. */
  changedAt: string
  /** Where it changed, e.g. "Mac · Chrome". */
  device: string
  /** A digest of the data, to tell real changes from a re-open. */
  signature: string
  /** Latest TD / Monarch transaction date in the data, YYYY-MM-DD. */
  tdThrough?: string
  monarchThrough?: string
}

const KEY = 'tidewater.etm.freshness'

/** "iPad · Safari", "Mac · Chrome"… from the browser's own description. */
export function deviceName(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent, touch = 0): string {
  const ua = userAgent
  // iPadOS reports itself as a Mac; touch points give it away.
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)
  const device = ipad
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'This device'
  const browser = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua)
    ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua)
      ? 'Firefox'
      : /Edg\//.test(ua)
        ? 'Edge'
        : /Safari\//.test(ua)
          ? 'Safari'
          : ''
  return browser ? `${device} · ${browser}` : device
}

const thisDevice = (): string =>
  deviceName(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
  )

/** A short, stable digest (FNV-1a) — enough to notice a change, not to secure anything. */
export function digest(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function asFreshness(raw: unknown): Freshness | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.changedAt !== 'string' || Number.isNaN(Date.parse(r.changedAt))) return undefined
  if (typeof r.device !== 'string' || typeof r.signature !== 'string') return undefined
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const td = day(r.tdThrough)
  const monarch = day(r.monarchThrough)
  return {
    changedAt: r.changedAt,
    device: r.device,
    signature: r.signature,
    ...(td ? { tdThrough: td } : {}),
    ...(monarch ? { monarchThrough: monarch } : {}),
  }
}

export function readFreshness(): Freshness | undefined {
  try {
    return asFreshness(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return undefined
  }
}

export function writeFreshness(freshness: Freshness | undefined): void {
  try {
    if (freshness) localStorage.setItem(KEY, JSON.stringify(freshness))
    else localStorage.removeItem(KEY)
  } catch {
    // Private browsing: the line just says "unknown".
  }
}

/**
 * Called whenever the unlocked data is (re)computed. A new signature means
 * the data changed here, now; the same one (a re-open, or the first open
 * after restoring a backup) keeps the record as it was.
 */
export function noteData(
  current: { signature: string; tdThrough?: string; monarchThrough?: string },
  stored: Freshness | undefined,
  /** With no record yet: the best guess at when the data last changed (its last import). */
  firstGuess?: string,
  now = new Date().toISOString(),
  device = thisDevice(),
): Freshness {
  const through = {
    ...(current.tdThrough ? { tdThrough: current.tdThrough } : {}),
    ...(current.monarchThrough ? { monarchThrough: current.monarchThrough } : {}),
  }
  if (stored && stored.signature === current.signature) return { ...stored, ...through }
  const changedAt = !stored && firstGuess && !Number.isNaN(Date.parse(firstGuess)) ? firstGuess : now
  return { changedAt, device, signature: current.signature, ...through }
}

export type Comparison = 'same' | 'backup-newer' | 'device-newer' | 'unknown'

/**
 * How a backup's data compares with this device's. When both say the same
 * moment but hold different data — the first record on each device is dated
 * by its last import, and later changes that weren't imports leave that date
 * alone — the backup file's own save time decides: saved after this device's
 * data last changed, it is the newer copy.
 */
export function compareFreshness(
  device: Freshness | undefined,
  backup: Freshness | undefined,
  fileSavedAt?: number,
): Comparison {
  if (!device || !backup) return 'unknown'
  if (device.signature === backup.signature) return 'same'
  const here = Date.parse(device.changedAt)
  const there = Date.parse(backup.changedAt)
  if (there !== here) return there > here ? 'backup-newer' : 'device-newer'
  if (fileSavedAt === undefined || !Number.isFinite(fileSavedAt)) return 'unknown'
  return fileSavedAt > here ? 'backup-newer' : 'unknown'
}

/** The freshness record inside a backup file's text, if it has one. */
export function freshnessInBackup(text: string): Freshness | undefined {
  try {
    const raw = JSON.parse(text) as { etm?: { freshness?: unknown } }
    return asFreshness(raw?.etm?.freshness)
  } catch {
    return undefined
  }
}
