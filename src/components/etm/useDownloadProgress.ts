import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadProgress, type DownloadProgress } from '../../lib/etm/statementFolder'
import {
  hasReadAccess,
  listNames,
  statementFolderSupported,
  type StatementFolderHandle,
} from '../../lib/etm/storage/statementFolder'
import { canWatchExportFolder } from '../../lib/etm/watchFolder'
import type { Account } from '../../lib/etm/types'

/** The Shortcut the TD downloader's README has you create. */
export const SHORTCUT_URL = 'shortcuts://run-shortcut?name=Tidewater%20TD%20Download'

/** Per device, not synced: only the Mac that has the downloader checked out says yes. */
const HERE_KEY = 'tidewater.etm.tdDownloaderHere'
const POLL_MS = 3000
const GIVE_UP_MS = 30 * 60 * 1000

export function downloaderAvailableHere(): boolean {
  if (typeof navigator === 'undefined') return false
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent)
  // A Mac-looking iPad passes the platform test; the touch check in
  // canWatchExportFolder is what keeps it out. Folder access is not needed to
  // start the download — only to follow it here — so Safari qualifies too.
  return mac && canWatchExportFolder()
}

/** Whether this browser can follow the run by watching the folder (Chrome, Edge — not Safari). */
export const canFollowDownload = (): boolean => statementFolderSupported()

export function readDownloaderHere(): boolean {
  try {
    return localStorage.getItem(HERE_KEY) === 'yes'
  } catch {
    return false
  }
}

export function writeDownloaderHere(on: boolean): void {
  try {
    if (on) localStorage.setItem(HERE_KEY, 'yes')
    else localStorage.removeItem(HERE_KEY)
  } catch {
    // A private window: the button simply stays hidden next time.
  }
}

export interface DownloadWatch {
  running: boolean
  progress?: DownloadProgress
  /** Why progress cannot be shown, when it cannot. */
  notice?: string
  timedOut: boolean
  start: () => void
  stop: () => void
}

/**
 * Starts the downloader's Shortcut and follows the run by listing the
 * statement folder every few seconds — names only, nothing is opened. The
 * Terminal window shows the same run in detail; this is the at-a-glance copy
 * inside Tidewater, ending with the combined file ready to read.
 */
export function useDownloadProgress(
  handle: StatementFolderHandle | undefined,
  accounts: Account[],
): DownloadWatch {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [timedOut, setTimedOut] = useState(false)
  const startedAt = useRef(0)

  const stop = useCallback(() => setRunning(false), [])

  const start = useCallback(() => {
    setTimedOut(false)
    setProgress(undefined)
    setNotice(
      handle
        ? undefined
        : statementFolderSupported()
          ? 'Choose the statement folder below to follow the download here; Terminal shows it either way.'
          : 'Follow the run in Terminal. When it says “Combined file ready”, use Choose the statement files below and pick that one TD-transactions file.',
    )
    startedAt.current = Date.now()
    setRunning(Boolean(handle))
    window.location.href = SHORTCUT_URL
  }, [handle])

  useEffect(() => {
    if (!running || !handle) return
    let live = true
    const day = localDay()
    const tick = async () => {
      if (!live) return
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setTimedOut(true)
        setRunning(false)
        return
      }
      if (!(await hasReadAccess(handle))) {
        setNotice('Tidewater has lost access to the statement folder. Read it once below to grant access again.')
        return
      }
      try {
        const next = downloadProgress(accounts, await listNames(handle), day)
        if (!live) return
        setProgress(next)
        if (next.combined) setRunning(false)
      } catch {
        // A listing mid-rename can fail; the next tick will see the settled folder.
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [accounts, handle, running])

  return { running, progress, notice, timedOut, start, stop }
}

/** The downloader names files by the Mac's local date, not UTC. */
function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
