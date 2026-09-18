/**
 * The output filename contract, in one place because another component reads
 * these files by name:
 *
 *     TD-<label-slug>-<lastFour>-<YYYY-MM-DD>.csv
 *
 * The date is today's *local* date, not UTC. A run at 9pm Eastern belongs to
 * that evening's date the way the person running it would say it, and a UTC
 * date would silently roll over mid-evening.
 */

export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Local YYYY-MM-DD. */
export function localDateStamp(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function outputFilename(label: string, lastFour: string, dateStamp: string): string {
  return `TD-${slugifyLabel(label)}-${lastFour}-${dateStamp}.csv`
}

/**
 * Downloads land under a temp name and are renamed once complete, so a Ctrl+C
 * or a crash mid-write can never leave something that looks like a finished
 * export to whatever reads this directory next.
 */
export function partialFilename(finalName: string): string {
  return `.${finalName}.partial`
}
