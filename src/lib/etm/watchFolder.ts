/**
 * Compare Monarch exports by name, size, and modified time. Listing a
 * watched folder uses these fingerprints only; the CSV is not parsed until
 * the user opens Import review.
 */

export interface ExportFingerprint {
  name: string
  size: number
  lastModified: number
}

export function isCsvName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || trimmed.startsWith('.')) return false
  return trimmed.toLowerCase().endsWith('.csv')
}

export function asFingerprint(value: unknown): ExportFingerprint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<ExportFingerprint>
  if (typeof record.name !== 'string' || !record.name.trim()) return undefined
  if (typeof record.size !== 'number' || !Number.isFinite(record.size) || record.size < 0) {
    return undefined
  }
  if (typeof record.lastModified !== 'number' || !Number.isFinite(record.lastModified)) {
    return undefined
  }
  return { name: record.name, size: record.size, lastModified: record.lastModified }
}

export function fingerprintOf(file: {
  name: string
  size: number
  lastModified: number
}): ExportFingerprint {
  return { name: file.name, size: file.size, lastModified: file.lastModified }
}

export function sameExport(a: ExportFingerprint, b: ExportFingerprint): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

/**
 * True when the candidate is not the file we already brought in.
 * `lastImportedName` covers vaults that have batches but no fingerprint yet:
 * the same filename is treated as already here until a watched import records
 * size and time.
 */
export function isNewerExport(
  candidate: ExportFingerprint,
  last?: ExportFingerprint,
  lastImportedName?: string,
): boolean {
  if (last) {
    if (sameExport(candidate, last)) return false
    if (candidate.lastModified !== last.lastModified) {
      return candidate.lastModified > last.lastModified
    }
    return candidate.size !== last.size || candidate.name !== last.name
  }
  if (lastImportedName && candidate.name === lastImportedName) return false
  return true
}

/** The browser only gives the last path segment, never the disk path. */
export function watchFolderLabel(name: string | undefined): string {
  const trimmed = name?.trim()
  return trimmed || 'that folder'
}

/** `Transactions/export.csv` → `Transactions`. */
export function folderNameFromPath(relativePath: string, fallback?: string): string {
  const top = relativePath.split(/[\\/]/)[0]?.trim()
  return watchFolderLabel(top || fallback)
}

export interface NewerExport {
  file: File
  fingerprint: ExportFingerprint
}

export function csvFilesIn(files: File[]): File[] {
  return files.filter((file) => isCsvName(file.name))
}

export function offerFromFiles(
  files: File[],
  last?: ExportFingerprint,
  lastImportedName?: string,
): { csvCount: number; newest?: ExportFingerprint; offer?: NewerExport } {
  const csvs = csvFilesIn(files)
  const newest = pickNewestCsv(csvs.map(fingerprintOf))
  if (!newest) return { csvCount: csvs.length }
  if (!isNewerExport(newest, last, lastImportedName)) {
    return { csvCount: csvs.length, newest }
  }
  const file = csvs.find((item) => item.name === newest.name)
  if (!file) return { csvCount: csvs.length, newest }
  return { csvCount: csvs.length, newest, offer: { file, fingerprint: fingerprintOf(file) } }
}

/** Newest CSV in a flat folder listing. Subfolders are ignored. */
export function pickNewestCsv(files: ExportFingerprint[]): ExportFingerprint | undefined {
  const csvs = files.filter((file) => isCsvName(file.name))
  if (csvs.length === 0) return undefined
  return csvs.reduce((best, file) => {
    if (file.lastModified > best.lastModified) return file
    if (file.lastModified === best.lastModified && file.size > best.size) return file
    return best
  })
}

export interface FolderWatchEnv {
  userAgent: string
  platform: string
  maxTouchPoints: number
}

/** iPhone/iPad cannot list a folder of CSVs; a directory input also breaks later file picks. */
export function canWatchExportFolder(
  env: FolderWatchEnv = typeof navigator === 'undefined'
    ? { userAgent: '', platform: '', maxTouchPoints: 0 }
    : {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
      },
): boolean {
  if (/iPad|iPhone|iPod/i.test(env.userAgent)) return false
  // iPadOS 13+ reports as Macintosh with a touch screen.
  if (env.platform === 'MacIntel' && env.maxTouchPoints > 1) return false
  return true
}
