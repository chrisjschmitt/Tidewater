import { del, get, set } from 'idb-keyval'

/**
 * The folder the statement downloader writes into, remembered between
 * sessions. Unlike the watched Monarch folder — chosen through a directory
 * input, which hands over a list of files and nothing reusable — this one is
 * picked through the File System Access API, whose handle survives a reload.
 *
 * What is kept is a permission token, not data: the folder's name and the
 * browser's own record that the user granted read access to it. Nothing
 * personal, so it can live in the plain store rather than the encrypted
 * vault, which is just as well — the vault holds ciphertext and a handle
 * cannot be serialized into any.
 *
 * The two settings are deliberately separate. The Monarch export and the TD
 * statements are different files with different jobs, and folding them into
 * one setting would mean picking one folder to mean both.
 */

const KEY = 'tidewater.etm.statementFolder'

/**
 * Only what is used, declared here: the File System Access API is not in the
 * DOM typings this project builds against, and a full ambient declaration
 * would claim more of it than the module touches.
 */
export interface StatementFolderEntry {
  kind: string
  name: string
  getFile?: () => Promise<File>
}

export interface StatementFolderHandle {
  name: string
  values: () => AsyncIterableIterator<StatementFolderEntry>
  queryPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>
}

type Picker = (options: { mode: 'read'; id: string }) => Promise<StatementFolderHandle>

const picker = (): Picker | undefined => {
  if (typeof window === 'undefined') return undefined
  const candidate = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
  return typeof candidate === 'function' ? candidate.bind(window) : undefined
}

export const statementFolderSupported = (): boolean => picker() !== undefined

/** Null when the user closed the dialog, which is not an error worth reporting. */
export async function pickStatementFolder(): Promise<StatementFolderHandle | null> {
  const open = picker()
  if (!open) return null
  try {
    // The id keeps the browser reopening the dialog where it was last, so the
    // folder is found once rather than hunted for again every month.
    return await open({ mode: 'read', id: 'tidewater-td-statements' })
  } catch {
    return null
  }
}

export async function rememberedStatementFolder(): Promise<StatementFolderHandle | undefined> {
  try {
    const stored = await get<StatementFolderHandle>(KEY)
    return stored && typeof stored.name === 'string' ? stored : undefined
  } catch {
    return undefined
  }
}

export async function rememberStatementFolder(handle: StatementFolderHandle): Promise<void> {
  await set(KEY, handle)
}

export async function forgetStatementFolder(): Promise<void> {
  try {
    await del(KEY)
  } catch {
    // Nothing to forget is the same outcome as having forgotten it.
  }
}

/**
 * A remembered handle goes stale: the browser drops the grant when the site's
 * data is cleared, and asks again after a restart. Re-prompting needs a user
 * gesture, so this is only ever called from a click.
 */
export async function ensureReadAccess(handle: StatementFolderHandle): Promise<boolean> {
  try {
    const current = await handle.queryPermission?.({ mode: 'read' })
    if (current === 'granted') return true
    const asked = await handle.requestPermission?.({ mode: 'read' })
    return asked === 'granted'
  } catch {
    return false
  }
}

export interface FolderFile {
  name: string
  /** Deferred: the listing is matched against the accounts before anything is read. */
  text: () => Promise<string>
}

/** A flat listing. Subfolders are not descended into. */
export async function listFiles(handle: StatementFolderHandle): Promise<FolderFile[]> {
  const files: FolderFile[] = []
  for await (const entry of handle.values()) {
    const getFile = entry.getFile
    if (entry.kind !== 'file' || !getFile) continue
    files.push({ name: entry.name, text: async () => (await getFile()).text() })
  }
  return files
}
