import { useCallback, useEffect, useState } from 'react'
import { planTdImport, type ImportPlan, type TdCategorizer } from '../../lib/etm/importer'
import { parseStatementCsv, StatementFormatError } from '../../lib/etm/statement'
import { newestCombined, parseTdCombinedCsv, pseudoFileName, TdFileError, type TdAccountBlock } from '../../lib/etm/td'
import type { GroupId } from '../../lib/types'
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
import type { Account, BalanceSnapshot, Transaction } from '../../lib/etm/types'

export interface StatementFolderReview {
  rows: StatementReviewRow[]
  /** Files in the folder that belong to no account on this step. */
  unmatched: StatementFileName[]
  /**
   * Accounts in the downloader's combined file that match no account in the
   * registry at all — almost always a missing “last four” on the Accounts tab.
   */
  unknownInFile?: string[]
  skipped: string[]
  /** Account ids the user is willing to record. Partial is allowed. */
  checked: Set<string>
  /**
   * The TD rows in the downloader's combined file, when that is what was read.
   * Brought in with the balances unless the user unticks it.
   */
  feed?: { plan: ImportPlan & { unmatchedBlocks: unknown[] }; fileName: string; include: boolean }
}

/** What the combined file's rows need to become a TD import alongside the balances. */
export interface FeedOptions {
  /** Every stored row, so a re-read of the same file adds nothing. */
  existing: Transaction[]
  groups?: Record<string, GroupId>
  categorize?: TdCategorizer
  onImport: (plan: ImportPlan) => Promise<void>
}

export interface StatementFolderState {
  /** Whether a folder can be picked and remembered. Files can always be chosen. */
  supported: boolean
  folderName?: string
  /** The remembered folder, for the download-progress watcher. */
  handle?: StatementFolderHandle
  busy: boolean
  notice?: string
  review: StatementFolderReview | null
  chooseFolder: () => Promise<void>
  readFolder: () => Promise<void>
  /** The picker-dialog path for browsers with no folder access — the iPad above all. */
  readFiles: (files: File[]) => Promise<void>
  forgetFolder: () => Promise<void>
  toggleRow: (accountId: string) => void
  toggleFeed: () => void
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
  feedOptions?: FeedOptions,
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

  /**
   * The shared middle: a list of named, readable files becomes the review,
   * wherever the list came from — a remembered folder on a desktop, or a
   * multi-select picker dialog on an iPad. Returns how many files matched so
   * the caller can word its own "nothing here" notice.
   */
  const buildReview = useCallback(
    async (listed: Array<{ name: string; text: () => Promise<string> }>) => {
      // The downloader's combined file, when present, stands in for the
      // per-account files: each account's block is read exactly as its own
      // export would have been, and its rows become the TD feed.
      let files = listed
      let feed: StatementFolderReview['feed']
      const blockNames = new Map<string, TdAccountBlock>()
      const combined = newestCombined(listed.map((file) => file.name))
      if (combined) {
        const source = listed.find((file) => file.name === combined.name)!
        const blocks = parseTdCombinedCsv(await source.text())
        for (const block of blocks) blockNames.set(pseudoFileName(block, combined.date), block)
        files = blocks.map((block) => ({
          name: pseudoFileName(block, combined.date),
          text: async () => block.asStatementText,
        }))
        if (feedOptions) {
          const plan = await planTdImport(blocks, {
            fileName: combined.name,
            fileDate: combined.date,
            accounts,
            existing: new Map(feedOptions.existing.map((row) => [row.id, row])),
            groups: feedOptions.groups,
            categorize: feedOptions.categorize,
          })
          feed = { plan, fileName: combined.name, include: plan.added.length > 0 }
        }
      }
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
      // Read through per-account stand-ins, but recorded against the file the
      // user actually has, so a balance's provenance names something real.
      const carry = {
        balances,
        ...(combined ? { downloadDate: combined.date, fileName: combined.name } : {}),
      }
      const rows = reviewRows(accounts, reads, month, carry).map((row) =>
        combined && row.file ? { ...row, file: { ...row.file, name: combined.name } } : row,
      )
      setReview({
        rows,
        // A combined file's blocks for accounts this step does not ask about
        // (Chris's own account, say) are expected, not worth flagging.
        unmatched: combined ? [] : match.unmatched,
        ...(combined
          ? {
              unknownInFile: matchStatementFiles(
                accounts,
                files.map((file) => file.name),
              ).unmatched.map((file) => {
                const block = blockNames.get(file.name)
                return block ? `${block.account} (…${block.lastFour})` : file.name
              }),
            }
          : {}),
        skipped: match.skipped,
        // Everything readable starts checked: the common case is that the
        // whole folder is right, and the point of the step is not to retype it.
        checked: new Set(rows.filter(isReadable).map((row) => row.account.id)),
        ...(feed ? { feed } : {}),
      })
      return match.byAccount.size + (feed?.plan.rowsRead ?? 0)
    },
    [accounts, balances, month, feedOptions],
  )

  const scan = useCallback(
    async (folder: StatementFolderHandle) => {
      setBusy(true)
      setNotice(undefined)
      try {
        if (!(await ensureReadAccess(folder))) {
          setNotice('Reading that folder was not allowed. Choose it again to grant access.')
          return
        }
        const matched = await buildReview(await listFiles(folder))
        if (matched === 0) {
          setNotice(
            `Nothing in “${folder.name}” read as a TD statement export. The downloader writes TD-transactions-<date>.csv (or, before version 0.2, one TD-<account>-<last four>-<date>.csv per account).`,
          )
        }
      } catch (err) {
        setNotice(err instanceof TdFileError ? err.message : 'That folder could not be read. Choose it again.')
      } finally {
        setBusy(false)
      }
    },
    [buildReview],
  )

  const readFiles = useCallback(
    async (picked: File[]) => {
      setBusy(true)
      setNotice(undefined)
      try {
        const matched = await buildReview(
          picked.map((file) => ({ name: file.name, text: () => file.text() })),
        )
        if (matched === 0) {
          setNotice(
            'None of the chosen files read as a TD statement export. Choose TD-transactions-<date>.csv (or the older per-account TD-<account>-<last four>-<date>.csv files).',
          )
        }
      } catch (err) {
        setNotice(err instanceof TdFileError ? err.message : 'Those files could not be read. Choose them again.')
      } finally {
        setBusy(false)
      }
    },
    [buildReview],
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

  const toggleFeed = useCallback(() => {
    setReview((current) =>
      current?.feed ? { ...current, feed: { ...current.feed, include: !current.feed.include } } : current,
    )
  }, [])

  const confirm = useCallback(async () => {
    if (!review) return
    setBusy(true)
    try {
      if (review.feed?.include && review.feed.plan.added.length > 0 && feedOptions) {
        await feedOptions.onImport(review.feed.plan)
      }
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
  }, [balances, feedOptions, month, onRecord, review])

  const dismiss = useCallback(() => {
    setReview(null)
    setNotice(undefined)
  }, [])

  return {
    supported,
    folderName: handle?.name,
    handle,
    busy,
    notice,
    review,
    chooseFolder,
    readFolder,
    readFiles,
    forgetFolder,
    toggleRow,
    toggleFeed,
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
