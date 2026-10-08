import { serializeTidewaterBackup } from '../../backup'
import { downloadFile } from '../../storage'
import type { Budget } from '../../types'
import { exportEtmVault } from './backup'
import type { StatementFolderHandle } from './statementFolder'

/**
 * Keeping the one copy of the data from being lost: ask the browser to keep
 * Tidewater's storage, remember when the last backup was made, and make one
 * — the same file as Your data → Download JSON (the plan plus the encrypted
 * expense vault), written into the TD statement folder when the browser can
 * write there, otherwise downloaded.
 */

export type PersistState = 'kept' | 'not-kept' | 'unsupported'

/** Asks once; browsers decide (Chrome by engagement, Safari more readily for a home-screen app). */
export async function keepStorage(): Promise<PersistState> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!storage?.persist || !storage.persisted) return 'unsupported'
  try {
    if (await storage.persisted()) return 'kept'
    return (await storage.persist()) ? 'kept' : 'not-kept'
  } catch {
    return 'not-kept'
  }
}

const LAST_BACKUP = 'tidewater.etm.lastBackup'

export function lastBackupAt(): string | undefined {
  try {
    return localStorage.getItem(LAST_BACKUP) ?? undefined
  } catch {
    return undefined
  }
}

function markBackedUp(): void {
  try {
    localStorage.setItem(LAST_BACKUP, new Date().toISOString())
  } catch {
    // A private window: the reminder simply cannot remember.
  }
}

export function daysSince(iso: string | undefined, now = Date.now()): number | undefined {
  if (!iso) return undefined
  const then = Date.parse(iso)
  return Number.isNaN(then) ? undefined : Math.floor((now - then) / 86_400_000)
}

interface WritableFolder extends StatementFolderHandle {
  getDirectoryHandle?: (name: string, options: { create: boolean }) => Promise<WritableFolder>
  getFileHandle?: (
    name: string,
    options: { create: boolean },
  ) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

export const BACKUP_FOLDER = 'Tidewater backups'

/**
 * Writes the backup. Into `<statement folder>/Tidewater backups/` when a
 * folder is remembered and the browser allows writing (Chrome asks once);
 * otherwise as a download (Safari, iPad). Returns where it went.
 */
export async function backUpNow(budget: Budget, folder?: StatementFolderHandle): Promise<string> {
  const vault = await exportEtmVault()
  const name = `tidewater-backup-${new Date().toISOString().slice(0, 10)}.json`
  const contents = serializeTidewaterBackup(budget, vault ?? undefined)

  const writable = folder as WritableFolder | undefined
  if (writable?.getDirectoryHandle && writable.requestPermission) {
    try {
      if ((await writable.requestPermission({ mode: 'readwrite' })) === 'granted') {
        const dir = await writable.getDirectoryHandle(BACKUP_FOLDER, { create: true })
        const file = await dir.getFileHandle!(name, { create: true })
        const stream = await file.createWritable()
        await stream.write(contents)
        await stream.close()
        markBackedUp()
        return `${folder!.name}/${BACKUP_FOLDER}/${name}`
      }
    } catch {
      // Fall through to a download: a backup that lands somewhere beats none.
    }
  }
  downloadFile(name, contents, 'application/json')
  markBackedUp()
  return `Downloads/${name}`
}
