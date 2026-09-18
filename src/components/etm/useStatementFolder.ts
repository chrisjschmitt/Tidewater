import { useCallback, useEffect, useState } from 'react'
import { parseStatementCsv, StatementFormatError } from '../../lib/etm/statement'
import {
  balanceAnchors,
  isReadable,
  matchStatementFiles,
  reviewRows,
  snapshotFor,
  type StatementFileName,
  type StatementRead,
  type StatementReviewRow,
} from '../../lib/etm/statementFolder'
import {
  ensureReadAccess,
  forgetStatementFolder,
  listFiles,
  pickStatementFolder,
  rememberStatementFolder,
  rememberedStatementFolder,
  statementFolderSupported,
  type StatementFolderHandle,
} from '../../lib/etm/storage/statementFolder'
import { canWatchExportFolder } from '../../lib/etm/watchFolder'
import { closingFor } from '../../lib/etm/workflow'
import { uid } from '../../lib/format'
import type { Account, BalanceSnapshot } from '../../lib/etm/types'

export interface StatementFolderReview {
  rows: StatementReviewRow[]
  /** Files in the folder that belong to no account on this step. */
  unmatched: StatementFileName[]
  skipped: string[]
  /** Account ids the user is willing to record. Partial is allowed. */
  checked: Set<string>
}

export interface StatementFolderState {
  supported: boolean
  folderName?: string
  busy: boolean
  notice?: string
  review: StatementFolderReview | null
  chooseFolder: () => Promise<void>
  readFolder: () => Promise<void>
  forgetFolder: () => Promise<void>
  toggleRow: (accountId: string) => void
  confirm: () => Promise<void>
  dismiss: () => void
}

/**
 * The browser half of the statement-folder read: pick a folder, keep the
 * handle, list it, and hold the review until the user confirms it. All of the
 * deciding — which file belongs to which account, what figure it yields — is
 * in `statementFolder.ts`, where it can be checked without a browser.
 *
 * Nothing is written on the way through. The review is state, and only
 * `confirm` reaches the store, through the same `recordBalance` the
 * one-at-a-time form uses.
 */
export function useStatementFolder(
  accounts: Account[],
  balances: BalanceSnapshot[],
  month: string,
  onRecord: (snapshot: BalanceSnapshot) => Promise<void>,
): StatementFolderState {
  const [handle, setHandle] = useState<StatementFolderHandle | undefined>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()
  const [review, setReview] = useState<StatementFolderReview | null>(null)

  // A directory input cannot list a folder on an iPhone or iPad, and the
  // picker this uses is not there at all, so the offer is withheld rather
  // than shown and then failing.
  const supported = statementFolderSupported() && canWatchExportFolder()

  useEffect(() => {
    let live = true
    void rememberedStatementFolder().then((stored) => {
      if (live && stored) setHandle(stored)
    })
    return () => {
      live = false
    }
  }, [])

  const scan = useCallback(
    async (folder: StatementFolderHandle) => {
      setBusy(true)
      setNotice(undefined)
      try {
        if (!(await ensureReadAccess(folder))) {
          setNotice('Reading that folder was not allowed. Choose it again to grant access.')
          return
        }
        const files = await listFiles(folder)
        // Only the accounts this step asks about, so a file for anything else
        // is reported as unmatched rather than quietly assigned somewhere.
        const match = matchStatementFiles(
          balanceAnchors(accounts),
          files.map((file) => file.name),
        )
        const reads = new Map<string, StatementRead>()
        for (const [accountId, name] of match.byAccount) {
          const file = files.find((item) => item.name === name.name)
          if (!file) continue
          reads.set(accountId, { file: name, ...(await read(file.text)) })
        }
        const rows = reviewRows(accounts, reads, month)
        setReview({
          rows,
          unmatched: match.unmatched,
          skipped: match.skipped,
          // Everything readable starts checked: the common case is that the
          // whole folder is right, and the point of the step is not to retype it.
          checked: new Set(rows.filter(isReadable).map((row) => row.account.id)),
        })
        if (match.byAccount.size === 0) {
          setNotice(
            `Nothing in “${folder.name}” read as a TD statement export. Files are expected to be named TD-<account>-<last four>-<date>.csv.`,
          )
        }
      } catch {
        setNotice('That folder could not be read. Choose it again.')
      } finally {
        setBusy(false)
      }
    },
    [accounts, month],
  )

  const chooseFolder = useCallback(async () => {
    const picked = await pickStatementFolder()
    if (!picked) return
    setHandle(picked)
    setReview(null)
    try {
      await rememberStatementFolder(picked)
    } catch {
      setNotice('The folder is in use this session, but it could not be remembered.')
    }
    await scan(picked)
  }, [scan])

  const readFolder = useCallback(async () => {
    if (!handle) {
      await chooseFolder()
      return
    }
    await scan(handle)
  }, [chooseFolder, handle, scan])

  const forgetFolder = useCallback(async () => {
    setHandle(undefined)
    setReview(null)
    setNotice(undefined)
    await forgetStatementFolder()
  }, [])

  const toggleRow = useCallback((accountId: string) => {
    setReview((current) => {
      if (!current) return current
      const checked = new Set(current.checked)
      if (checked.has(accountId)) checked.delete(accountId)
      else checked.add(accountId)
      return { ...current, checked }
    })
  }, [])

  const confirm = useCallback(async () => {
    if (!review) return
    setBusy(true)
    try {
      for (const row of review.rows) {
        if (!review.checked.has(row.account.id)) continue
        // Reuse the id of any balance already recorded for this month, so a
        // second read corrects the figure rather than sitting beside it.
        const existing = closingFor(balances, row.account.id, month)
        const snapshot = snapshotFor(row, existing?.id ?? uid('bal'), existing)
        if (snapshot) await onRecord(snapshot)
      }
      setReview(null)
    } finally {
      setBusy(false)
    }
  }, [balances, month, onRecord, review])

  const dismiss = useCallback(() => {
    setReview(null)
    setNotice(undefined)
  }, [])

  return {
    supported,
    folderName: handle?.name,
    busy,
    notice,
    review,
    chooseFolder,
    readFolder,
    forgetFolder,
    toggleRow,
    confirm,
    dismiss,
  }
}

/** A file that will not parse is reported on its own row, not thrown away. */
async function read(text: () => Promise<string>): Promise<Omit<StatementRead, 'file'>> {
  try {
    return { reading: parseStatementCsv(await text()) }
  } catch (err) {
    return {
      error:
        err instanceof StatementFormatError
          ? err.message
          : 'That file could not be read as a statement.',
    }
  }
}
