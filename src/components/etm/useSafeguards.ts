import { useCallback, useEffect, useState } from 'react'
import { rememberedStatementFolder } from '../../lib/etm/storage/statementFolder'
import {
  allowBackupFolder,
  autoBackUp,
  autoBackupOn,
  backUpNow,
  backupFolderPermission,
  backupFolderSupported,
  daysSince,
  forgetBackupFolder,
  keepStorage,
  lastBackupAt,
  pickBackupFolder,
  rememberedBackupFolder,
  setAutoBackup,
  type BackupFolderHandle,
  type PersistState,
} from '../../lib/etm/storage/safeguards'
import type { Budget } from '../../lib/types'

/** How old a backup may get before Tidewater mentions it. */
export const BACKUP_NUDGE_DAYS = 7

export interface Safeguards {
  persist: PersistState | 'checking'
  lastBackup?: string
  ageDays?: number
  busy: boolean
  savedTo?: string
  backUp: () => Promise<void>
  /** Chrome only: a folder chosen for backups, written into automatically. */
  folderSupported: boolean
  folder?: { name: string; allowed: boolean }
  chooseFolder: () => Promise<void>
  allowFolder: () => Promise<void>
  forgetFolder: () => Promise<void>
  auto: boolean
  setAuto: (on: boolean) => void
  /** Backs up silently when the folder allows it; called after imports and review sessions. */
  autoBackUpNow: () => Promise<void>
}

export function useSafeguards(budget: Budget): Safeguards {
  const [persist, setPersist] = useState<PersistState | 'checking'>('checking')
  const [lastBackup, setLastBackup] = useState(lastBackupAt)
  const [busy, setBusy] = useState(false)
  const [savedTo, setSavedTo] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void keepStorage().then((state) => live && setPersist(state))
    return () => {
      live = false
    }
  }, [])

  const [folder, setFolder] = useState<{ name: string; allowed: boolean } | undefined>()
  const [auto, setAutoState] = useState(autoBackupOn)
  const describe = useCallback(async (handle: BackupFolderHandle | undefined) => {
    setFolder(handle ? { name: handle.name, allowed: (await backupFolderPermission(handle)) === 'granted' } : undefined)
  }, [])
  useEffect(() => {
    void rememberedBackupFolder().then(describe)
  }, [describe])

  const chooseFolder = useCallback(async () => {
    const handle = await pickBackupFolder()
    if (handle) await describe(handle)
  }, [describe])
  const allowFolder = useCallback(async () => {
    const handle = await rememberedBackupFolder()
    if (handle) {
      await allowBackupFolder(handle)
      await describe(handle)
    }
  }, [describe])
  const forgetFolder = useCallback(async () => {
    await forgetBackupFolder()
    setFolder(undefined)
  }, [])
  const setAuto = useCallback((on: boolean) => {
    setAutoBackup(on)
    setAutoState(on)
  }, [])
  const autoBackUpNow = useCallback(async () => {
    const where = await autoBackUp(budget)
    if (where) {
      setSavedTo(where)
      setLastBackup(lastBackupAt())
    }
  }, [budget])

  const backUp = useCallback(async () => {
    setBusy(true)
    try {
      const folder = await rememberedStatementFolder()
      setSavedTo(await backUpNow(budget, folder))
      setLastBackup(lastBackupAt())
      await describe(await rememberedBackupFolder())
    } finally {
      setBusy(false)
    }
  }, [budget, describe])

  return {
    persist,
    lastBackup,
    ageDays: daysSince(lastBackup),
    busy,
    savedTo,
    backUp,
    folderSupported: backupFolderSupported(),
    ...(folder ? { folder } : {}),
    chooseFolder,
    allowFolder,
    forgetFolder,
    auto,
    setAuto,
    autoBackUpNow,
  }
}
