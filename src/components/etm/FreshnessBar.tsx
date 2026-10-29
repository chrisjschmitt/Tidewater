import { useEffect, useRef, useState } from 'react'
import {
  compareFreshness,
  deviceName,
  freshnessInBackup,
  type Comparison,
  type Freshness,
} from '../../lib/etm/freshness'
import { newestBackupInFolder } from '../../lib/etm/storage/safeguards'

/**
 * The top of Expenses: how fresh this device's data is, and whether the
 * latest backup holds something newer — read from the backup folder by
 * itself where the browser allows (Chrome on the Mac), or from a backup file
 * you pick (Safari, the iPad).
 */
export default function FreshnessBar({
  freshness,
  onRestore,
}: {
  freshness: Freshness | undefined
  onRestore: (file: File) => void
}) {
  const [found, setFound] = useState<{ file: File; backup: Freshness | undefined; result: Comparison } | null>(null)
  const [checking, setChecking] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const check = async (file: File) => {
    const backup = freshnessInBackup(await file.text())
    setFound({ file, backup, result: compareFreshness(freshness, backup, file.lastModified) })
  }

  // Where the backup folder can be read without asking, look on opening.
  const signature = freshness?.signature
  useEffect(() => {
    let cancelled = false
    void newestBackupInFolder().then(async (file) => {
      if (!file || cancelled) return
      const backup = freshnessInBackup(await file.text())
      if (!cancelled) setFound({ file, backup, result: compareFreshness(freshness, backup, file.lastModified) })
    })
    return () => {
      cancelled = true
    }
    // Re-check when the data here changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const newer = found?.result === 'backup-newer'
  return (
    <div
      className={`mb-6 rounded-2xl border px-4 py-3 ${newer ? 'border-shell-300 bg-shell-50/70' : 'border-sand-200 bg-white/70'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-700">
          <span className="font-medium">Data on this {deviceOnly()}:</span>{' '}
          {freshness ? describe(freshness) : 'not yet dated — it will be after the next change or restore.'}
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={picker}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setChecking(true)
              void check(file).finally(() => setChecking(false))
            }}
          />
          <button type="button" className="btn-ghost text-xs" onClick={() => picker.current?.click()}>
            {checking ? 'Checking…' : 'Check the latest backup'}
          </button>
        </div>
      </div>

      {found && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 pt-2 text-sm">
          <p className={newer ? 'font-medium text-ink-900' : 'text-ink-600'}>
            {found.result === 'same' && `Up to date — ${found.file.name} holds the same data as this device.`}
            {found.result === 'backup-newer' &&
              `Newer data in ${found.file.name}: ${describe(found.backup!)}. Restore it before working here.`}
            {found.result === 'device-newer' &&
              `This device has newer changes than ${found.file.name} (${describe(found.backup!)}). Back up here so other devices can catch up.`}
            {found.result === 'unknown' &&
              (found.backup
                ? `${found.file.name} holds different data from this device, and its dates don’t say which is newer. If it was saved on the device you last worked on, restore it.`
                : `${found.file.name} doesn’t say when its data changed — it was made before 0.13.35. Its file date is the best guide.`)}
          </p>
          {newer && (
            <button type="button" className="btn-primary text-xs" onClick={() => onRestore(found.file)}>
              Restore {found.file.name}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** "iPad", "Mac"… — this browser's device, without the browser name. */
const deviceOnly = (): string => deviceName(navigator.userAgent, navigator.maxTouchPoints).split(' · ')[0]!

const dayLabel = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function describe(f: Freshness): string {
  const when = new Date(f.changedAt)
  const changed = `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  const parts = [
    f.tdThrough ? `TD to ${dayLabel(f.tdThrough)}` : undefined,
    f.monarchThrough ? `Monarch to ${dayLabel(f.monarchThrough)}` : undefined,
    `last changed ${changed} on ${f.device}`,
  ].filter(Boolean)
  return parts.join(' · ')
}
