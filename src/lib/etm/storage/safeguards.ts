import { del, get, set } from 'idb-keyval'
import { backupFileName, serializeTidewaterBackup } from '../../backup'
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

// --- The backup folder -------------------------------------------------------
//
// A folder chosen once for backups — e.g. iCloud Drive → Tidewater/Backups —
// that Tidewater writes into directly, and automatically after an import or
// a review session. Chrome only (File System Access); Safari and the iPad
// keep the reminder. Like the statement folder, what is kept is the
// browser's permission token, not data, so it lives outside the vault.

const BACKUP_FOLDER_KEY = 'tidewater.etm.backupFolder'
const AUTO_KEY = 'tidewater.etm.autoBackup'

export interface BackupFolderHandle {
  name: string
  getFileHandle: WritableFolder['getFileHandle']
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>
}

type ReadWritePicker = (options: { mode: 'readwrite'; id: string }) => Promise<BackupFolderHandle>

const readWritePicker = (): ReadWritePicker | undefined => {
  if (typeof window === 'undefined') return undefined
  const candidate = (window as unknown as { showDirectoryPicker?: ReadWritePicker }).showDirectoryPicker
  return typeof candidate === 'function' ? candidate.bind(window) : undefined
}

export const backupFolderSupported = (): boolean => readWritePicker() !== undefined

/** Null when the dialog was closed. */
export async function pickBackupFolder(): Promise<BackupFolderHandle | null> {
  const open = readWritePicker()
  if (!open) return null
  try {
    const handle = await open({ mode: 'readwrite', id: 'tidewater-backups' })
    await set(BACKUP_FOLDER_KEY, handle)
    return handle
  } catch {
    return null
  }
}

export async function rememberedBackupFolder(): Promise<BackupFolderHandle | undefined> {
  try {
    const stored = await get<BackupFolderHandle>(BACKUP_FOLDER_KEY)
    return stored && typeof stored.name === 'string' ? stored : undefined
  } catch {
    return undefined
  }
}

export async function forgetBackupFolder(): Promise<void> {
  try {
    await del(BACKUP_FOLDER_KEY)
  } catch {
    // Nothing to forget.
  }
}

/** Whether Tidewater may write there now without asking ('prompt' needs a click first). */
export async function backupFolderPermission(folder: BackupFolderHandle): Promise<PermissionState> {
  try {
    return (await folder.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt'
  } catch {
    return 'prompt'
  }
}

/** Asks for permission; only from a click. */
export async function allowBackupFolder(folder: BackupFolderHandle): Promise<boolean> {
  try {
    return (await folder.requestPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

export function autoBackupOn(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAutoBackup(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off')
  } catch {
    // A private window: stays on.
  }
}



async function writeInto(folder: { getFileHandle?: WritableFolder['getFileHandle'] }, name: string, contents: string): Promise<void> {
  const file = await folder.getFileHandle!(name, { create: true })
  const stream = await file.createWritable()
  await stream.write(contents)
  await stream.close()
}

/**
 * The automatic backup: into the chosen backup folder, only when the browser
 * already allows it (no dialog can open without a click). Returns where it
 * went, or undefined when it could not be made silently. One file per day,
 * rewritten through the day, so each day keeps its last state.
 */
export async function autoBackUp(budget: Budget): Promise<string | undefined> {
  if (!autoBackupOn()) return undefined
  const folder = await rememberedBackupFolder()
  if (!folder || (await backupFolderPermission(folder)) !== 'granted') return undefined
  try {
    const vault = await exportEtmVault()
    const name = backupFileName(Boolean(vault))
    await writeInto(folder, name, serializeTidewaterBackup(budget, vault ?? undefined))
    markBackedUp()
    return `${folder.name}/${name}`
  } catch {
    return undefined
  }
}

/**
 * Writes the backup: into the chosen backup folder when there is one (asking
 * for permission if needed — this runs from a click); else into
 * `<statement folder>/Tidewater backups/` when the browser allows writing;
 * otherwise as a download (Safari, iPad). Returns where it went.
 */
export async function backUpNow(budget: Budget, folder?: StatementFolderHandle): Promise<string> {
  const vault = await exportEtmVault()
  const name = backupFileName(Boolean(vault))
  const contents = serializeTidewaterBackup(budget, vault ?? undefined)

  const chosen = await rememberedBackupFolder()
  if (chosen && ((await backupFolderPermission(chosen)) === 'granted' || (await allowBackupFolder(chosen)))) {
    try {
      await writeInto(chosen, name, contents)
      markBackedUp()
      return `${chosen.name}/${name}`
    } catch {
      // Fall through to the older places.
    }
  }

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
