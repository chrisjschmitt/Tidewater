import { useCallback, useEffect, useState } from 'react'
import { rememberedStatementFolder } from '../../lib/etm/storage/statementFolder'
import { backUpNow, daysSince, keepStorage, lastBackupAt, type PersistState } from '../../lib/etm/storage/safeguards'
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

  const backUp = useCallback(async () => {
    setBusy(true)
    try {
      const folder = await rememberedStatementFolder()
      setSavedTo(await backUpNow(budget, folder))
      setLastBackup(lastBackupAt())
    } finally {
      setBusy(false)
    }
  }, [budget])

  return { persist, lastBackup, ageDays: daysSince(lastBackup), busy, savedTo, backUp }
}
