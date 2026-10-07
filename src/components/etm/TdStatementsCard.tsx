import { useMemo, useRef, useState } from 'react'
import type { EtmData } from './useEtmData'
import { useStatementFolder, type StatementFolderReview } from './useStatementFolder'
import {
  canFollowDownload,
  downloaderAvailableHere,
  readDownloaderHere,
  useDownloadProgress,
  writeDownloaderHere,
  type DownloadWatch,
} from './useDownloadProgress'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import { isReadable } from '../../lib/etm/statementFolder'

/**
 * The TD statements, on the Import tab: start the downloader, follow it, and
 * read the combined file it writes. One read brings in the TD transactions and
 * records each account's closing balance for the chosen month — which Month
 * end then shows on its Closing balances step.
 */
export default function TdStatementsCard({ data }: { data: EtmData }) {
  const [month, setMonth] = useState(thisMonth)
  const months = useMemo(() => [thisMonth(), previousMonth(thisMonth())], [])
  const feedOptions = useMemo(
    () => ({ existing: data.allRows, groups: data.config.categoryGroups, onImport: (plan: Parameters<EtmData['applyImport']>[0]) => data.applyImport(plan) }),
    [data],
  )
  const folder = useStatementFolder(data.accounts, data.balances, month, data.recordBalance, feedOptions)
  const download = useDownloadProgress(folder.handle, data.accounts)
  const [downloaderHere, setDownloaderHere] = useState(readDownloaderHere)
  const canDownload = downloaderAvailableHere()
  const [dragging, setDragging] = useState(false)
  // The picker-dialog path for browsers that cannot hold a folder handle —
  // Safari and the iPad. One multi-select in Files beats nine single reads.
  const filePicker = useRef<HTMLInputElement>(null)

  if (data.accounts.length === 0) {
    return (
      <div className="rounded-2xl bg-white/70 px-4 py-3.5 text-sm text-ink-500">
        TD statements: add your accounts first, on the Accounts tab, each with its last four
        digits — that is what ties a statement to an account.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold text-ink-900">TD statements</h3>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Record closing balances for
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="rounded-lg border border-sand-200 bg-white px-2 py-1 text-xs"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canDownload && (
        <DownloadFromTd
          watch={download}
          enabled={downloaderHere}
          onEnable={(on) => {
            writeDownloaderHere(on)
            setDownloaderHere(on)
          }}
          onRead={() => void folder.readFolder()}
        />
      )}
      <div
        className={`rounded-2xl px-4 py-3.5 transition-colors ${dragging ? 'bg-tide-50 ring-2 ring-tide-300' : 'bg-white/70'}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const files = Array.from(event.dataTransfer.files).filter((file) => /\.csv$/i.test(file.name))
          if (files.length > 0) void folder.readFiles(files)
        }}
      >
        <p className="text-sm font-medium text-ink-900">
          {folder.supported ? 'Read a folder of statements' : 'Read the statement files together'}
        </p>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          {folder.supported
            ? folder.folderName
              ? `Statements are read from “${folder.folderName}”. Every account below is listed with what its file says, and nothing is recorded until you confirm it.`
              : 'If the statements are downloaded into one folder, pick it once and every account’s closing balance can be read in a single pass. Nothing is recorded until you confirm it.'
            : 'This browser cannot hold on to a folder, so choose the downloader’s TD-transactions-<date>.csv file (or, for older downloads, select every account’s file together). Nothing is recorded until you confirm it.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {folder.supported ? (
            <>
              <button
                onClick={() => void folder.readFolder()}
                disabled={folder.busy}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {folder.busy
                  ? 'Reading…'
                  : folder.folderName
                    ? 'Read statement folder'
                    : 'Choose a folder'}
              </button>
              {folder.folderName && (
                <>
                  <button onClick={() => void folder.chooseFolder()} className="btn-ghost text-xs">
                    Choose a different folder
                  </button>
                  <button onClick={() => void folder.forgetFolder()} className="btn-quiet text-xs">
                    Forget this folder
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <input
                ref={filePicker}
                type="file"
                multiple
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  // Cleared so choosing the same files next month fires again.
                  event.target.value = ''
                  if (files.length > 0) void folder.readFiles(files)
                }}
              />
              <button
                onClick={() => filePicker.current?.click()}
                disabled={folder.busy}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {folder.busy ? 'Reading…' : 'Choose the statement files'}
              </button>
              <span className="text-xs text-ink-400">or drag the TD-transactions file onto this box</span>
            </>
          )}
        </div>
        {folder.notice && <p className="mt-3 text-sm text-shell-500">{folder.notice}</p>}
      </div>

      {folder.review && (
        <div className="animate-fade">
          <StatementFolderReviewTable
            review={folder.review}
            busy={folder.busy}
            month={month}
            onToggle={folder.toggleRow}
            onToggleFeed={folder.toggleFeed}
            onConfirm={() => void folder.confirm()}
            onCancel={folder.dismiss}
          />
        </div>
      )}

    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y! - 1}-12` : `${y}-${pad(m! - 1)}`
}

/**
 * Every account the step asks about, with what its statement says. Rows that
 * could not be read are shown rather than dropped: a balance that quietly
 * failed to arrive is the one thing that would spoil the reconciliation.
 */
function StatementFolderReviewTable({
  review,
  busy,
  month,
  onToggle,
  onToggleFeed,
  onConfirm,
  onCancel,
}: {
  review: StatementFolderReview
  busy: boolean
  month: string
  onToggle: (accountId: string) => void
  onToggleFeed: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const readable = review.rows.filter(isReadable)
  const chosen = readable.filter((row) => review.checked.has(row.account.id)).length
  const feed = review.feed
  const feedNew = feed?.plan.added.length ?? 0
  const bringing = Boolean(feed?.include && feedNew > 0)

  return (
    <div className="space-y-3 rounded-2xl bg-white/70 px-4 py-4">
      <p className="text-sm font-medium text-ink-900">
        What the statements in that folder say
      </p>

      <div className="space-y-1.5">
        {review.rows.map((row) => {
          const ready = isReadable(row)
          return (
            <label
              key={row.account.id}
              className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-sand-100"
            >
              <input
                type="checkbox"
                className="mt-1"
                disabled={!ready}
                checked={ready && review.checked.has(row.account.id)}
                onChange={() => onToggle(row.account.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {row.account.nickname}
                  {row.account.kind === 'credit' && <Tag>Owed</Tag>}
                  {row.outsideMonth && (
                    <Tag tone="warn">Outside {monthName(month).split(' ')[0]}</Tag>
                  )}
                  {row.carriedFrom && <Tag>Carried forward</Tag>}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {isReadable(row) && row.carriedFrom
                    ? `${amountIn(row.balance, row.account.currency)} as of ${row.asOf} · unchanged since ${row.carriedFrom}${row.reading.rows === 0 ? ' (not in the file: TD exports nothing for an account with no transactions)' : ', no transactions since'}`
                    : isReadable(row)
                    ? `${amountIn(row.balance, row.account.currency)} as of ${row.reading.date} · ${row.reading.rows.toLocaleString()} rows · ${row.file.name}`
                    : row.error
                      ? `${row.file?.name ?? 'That file'} — ${row.error}`
                      : !row.account.lastFour?.trim()
                        ? 'Not recorded: this account has no last four digits, so nothing in the file could be matched to it. Add them on the Accounts tab, then read the file again.'
                        : `Nothing in the file for …${row.account.lastFour}. TD skips an account with no transactions in the period; enter its balance by hand if so.`}
                </span>
              </span>
            </label>
          )
        })}
      </div>

      {review.unknownInFile && review.unknownInFile.length > 0 && (
        <p className="rounded-xl bg-sand-100 px-3 py-2 text-sm text-shell-500">
          In the file but not matched to any account, so not recorded:{' '}
          {review.unknownInFile.join(', ')}. Add those last four digits to the right account on the
          Accounts tab, then read the file again.
        </p>
      )}

      {review.unmatched.length > 0 && (
        <p className="text-xs text-ink-400">
          Not matched to any account on this step:{' '}
          {review.unmatched.map((file) => file.name).join(', ')}. Adding the last four
          digits on the Accounts tab is what ties a file to an account.
        </p>
      )}

      {review.skipped.length > 0 && (
        <p className="text-xs text-ink-400">
          Named unlike the rest, so left alone: {review.skipped.join(', ')}.
        </p>
      )}

      {feed && (
        <label className="flex items-start gap-3 rounded-xl bg-sand-100/60 px-2 py-2">
          <input
            type="checkbox"
            className="mt-1"
            disabled={feedNew === 0}
            checked={bringing}
            onChange={onToggleFeed}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">
              {feedNew > 0
                ? `Also bring in ${feedNew.toLocaleString()} TD transaction${feedNew === 1 ? '' : 's'}`
                : 'Every TD transaction in this file is already here'}
            </span>
            <span className="block text-[11px] text-ink-400">
              From {feed.fileName}
              {feed.plan.unchanged > 0 && ` · ${feed.plan.unchanged.toLocaleString()} already here`}
              {feed.plan.unmatched.length > 0 &&
                ` · not matched to an account: ${feed.plan.unmatched.map((u) => u.monarchName).join(', ')}`}
              . Until the switch-over, these are kept beside Monarch's rows for comparison and do not
              count in any total.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onConfirm}
          disabled={busy || (chosen === 0 && !bringing)}
          className="btn-primary text-xs disabled:opacity-50"
        >
          {chosen === 0 && bringing
            ? `Bring in ${feedNew.toLocaleString()} TD rows`
            : `Record ${chosen} balance${chosen === 1 ? '' : 's'}${bringing ? ` and ${feedNew.toLocaleString()} TD rows` : ''}`}
        </button>
        <button onClick={onCancel} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Mac only: starts the TD downloader through its Shortcut and follows the run
 * by watching the statement folder, one tick per account, until the combined
 * file is there to read. Shown once this Mac has been marked as the one with
 * the downloader on it.
 */
function DownloadFromTd({
  watch,
  enabled,
  onEnable,
  onRead,
}: {
  watch: DownloadWatch
  enabled: boolean
  onEnable: (on: boolean) => void
  onRead: () => void
}) {
  if (!enabled) {
    return (
      <div className="rounded-2xl bg-white/50 px-4 py-3">
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <input type="checkbox" checked={false} onChange={() => onEnable(true)} />
          This Mac has the TD downloader — show a “Download from TD” button here
        </label>
      </div>
    )
  }

  const progress = watch.progress
  const done = progress?.accounts.filter((a) => a.state === 'downloaded').length ?? 0
  const total = progress?.accounts.length ?? 0

  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3.5">
      <p className="text-sm font-medium text-ink-900">Download from TD</p>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        Opens the bank Chrome window through the “Tidewater TD Download” Shortcut. Log in by hand,
        click Continue, and the download runs in Terminal.{' '}
        {canFollowDownload()
          ? 'Each account ticks off here as its file arrives.'
          : 'This browser cannot watch the folder, so follow the run in Terminal, then choose the TD-transactions file below.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={watch.start} disabled={watch.running} className="btn-primary text-xs disabled:opacity-50">
          {watch.running ? 'Downloading…' : 'Download from TD'}
        </button>
        {watch.running && (
          <button onClick={watch.stop} className="btn-ghost text-xs">
            Stop watching
          </button>
        )}
        <button onClick={() => onEnable(false)} className="btn-quiet text-xs">
          Hide on this Mac
        </button>
      </div>
      {watch.notice && <p className="mt-3 text-sm text-shell-500">{watch.notice}</p>}
      {watch.timedOut && (
        <p className="mt-3 text-sm text-shell-500">
          Stopped watching after 30 minutes. Terminal has the run’s own report.
        </p>
      )}
      {progress && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-ink-400">
            {done} of {total} accounts downloaded
          </p>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {progress.accounts.map(({ account, state }) => (
              <li key={account.id} className="flex items-center gap-2 text-sm">
                <span className={state === 'downloaded' ? 'text-tide-700' : 'text-ink-300'}>
                  {state === 'downloaded' ? '✓' : '○'}
                </span>
                <span className={state === 'downloaded' ? 'text-ink-900' : 'text-ink-400'}>
                  {account.nickname}
                </span>
              </li>
            ))}
          </ul>
          {progress.combined && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-900">
                Combined file ready: {progress.combined}
              </span>
              <button onClick={onRead} className="btn-primary text-xs">
                Read it now
              </button>
            </div>
          )}
          {(progress.combined || watch.timedOut) && done < total && (
            <p className="text-xs text-shell-500">
              Not downloaded:{' '}
              {progress.accounts
                .filter((a) => a.state === 'waiting')
                .map((a) => a.account.nickname)
                .join(', ')}
              . Terminal’s report says why; their balances can be entered by hand below.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const Tag = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) => (
  <span
    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-normal uppercase tracking-wider ${
      tone === 'warn' ? 'bg-shell-300/40 text-shell-500' : 'bg-sand-200 text-ink-500'
    }`}
  >
    {children}
  </span>
)
