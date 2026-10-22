import type { Safeguards } from './useSafeguards'

/**
 * Settings → Backups. Tidewater keeps one copy of everything, in this
 * browser; this is how that copy survives a cleared browser or a new Mac.
 */
export default function BackupCard({ safeguards, onRestore }: { safeguards: Safeguards; onRestore?: (file: File) => void }) {
  const { persist, lastBackup, ageDays, busy, savedTo, backUp, folderSupported, folder, chooseFolder, allowFolder, forgetFolder, auto, setAuto } =
    safeguards
  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Backups</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        Everything — the plan, every transaction from Monarch and TD, your reviews, rules and balances — lives only in
        this browser, encrypted with your expense key. A backup is that same encrypted data in one file; restore it from
        Your data → Choose JSON with the same key. Back up weekly, and keep the key in your password manager.
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-white/70 px-4 py-3">
          <dt className="text-[11px] uppercase tracking-wider text-ink-400">Last backup</dt>
          <dd className={`mt-1 ${ageDays === undefined || ageDays >= 7 ? 'text-shell-500' : 'text-ink-900'}`}>
            {lastBackup
              ? `${new Date(lastBackup).toLocaleString()} (${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`})`
              : 'None made with this button on this device yet'}
          </dd>
        </div>
        <div className="rounded-2xl bg-white/70 px-4 py-3">
          <dt className="text-[11px] uppercase tracking-wider text-ink-400">Browser keeps the data</dt>
          <dd className="mt-1 text-ink-900">
            {persist === 'checking'
              ? 'Checking…'
              : persist === 'kept'
                ? 'Yes — it will not be cleared to free up space'
                : persist === 'unsupported'
                  ? 'This browser cannot promise it — back up regularly'
                  : 'Not promised yet — the browser decides; back up regularly'}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={busy} onClick={() => void backUp()} className="btn-primary text-xs disabled:opacity-50">
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        {onRestore && (
          <label className="btn-ghost cursor-pointer text-xs">
            Restore from a backup…
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onRestore(file)
              }}
            />
          </label>
        )}
        {savedTo && <span className="text-xs text-ink-500">Saved to {savedTo}</span>}
      </div>
      {onRestore && (
        <p className="mt-2 text-xs text-ink-400">
          Restoring replaces the plan and all expense data on this device with the file’s — it asks first. Then unlock
          with the same key.
        </p>
      )}
      {folderSupported ? (
        <div className="mt-4 rounded-2xl bg-sand-100/60 px-4 py-3 text-sm">
          <p className="font-medium text-ink-900">Backup folder</p>
          {folder ? (
            <>
              <p className="mt-0.5 text-ink-700">
                {folder.name}
                {!folder.allowed && <span className="text-shell-500"> · Chrome needs permission again</span>}
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-700">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Back up here automatically after each import and review session
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {!folder.allowed && (
                  <button className="btn-primary text-xs" onClick={() => void allowFolder()}>
                    Allow backups to {folder.name}
                  </button>
                )}
                <button className="btn-ghost text-xs" onClick={() => void chooseFolder()}>
                  Choose another folder
                </button>
                <button className="btn-quiet text-xs" onClick={() => void forgetFolder()}>
                  Stop using this folder
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-400">
                One file a day (tidewater-backup-YYYY-MM-DD.json), rewritten with that day’s latest. Chrome may ask
                once per visit before writing — choose “Allow on every visit” to make it silent.
              </p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-ink-500">
                Choose a folder once — e.g. iCloud Drive → Tidewater → Backups — and Tidewater saves a backup there
                after each import and review session, as well as when you click Back up now.
              </p>
              <button className="btn-ghost mt-2 text-xs" onClick={() => void chooseFolder()}>
                Choose a backup folder
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-400">
          This browser can’t save into a folder, so backups go to Downloads — move them to your iCloud backups folder.
          In Chrome on the Mac, Tidewater can back up to a folder automatically.
        </p>
      )}
    </section>
  )
}
