import type { Safeguards } from './useSafeguards'

/**
 * Settings → Backups. Tidewater keeps one copy of everything, in this
 * browser; this is how that copy survives a cleared browser or a new Mac.
 */
export default function BackupCard({ safeguards }: { safeguards: Safeguards }) {
  const { persist, lastBackup, ageDays, busy, savedTo, backUp } = safeguards
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
        {savedTo && <span className="text-xs text-ink-500">Saved to {savedTo}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-400">
        In Chrome, with the TD statement folder chosen, the file goes into its “Tidewater backups” folder on Google
        Drive (Chrome asks once to allow writing). In Safari or on the iPad it goes to Downloads — move it somewhere safe.
      </p>
    </section>
  )
}
