import type { GroupId } from '../../lib/types'
import { useEffect, useState } from 'react'
import ImportProgress, { type ImportProgressState } from '../ImportProgress'
import { AccountForm, blankAccount } from './AccountsPanel'
import { planImport, type ImportPlan } from '../../lib/etm/importer'
import { MonarchFormatError } from '../../lib/etm/monarch'
import { amountIn, monthLabel } from '../../lib/etm/format'
import { fingerprintOf, type ExportFingerprint } from '../../lib/etm/watchFolder'
import type { Account, ImportBatch, Transaction } from '../../lib/etm/types'

interface Props {
  accounts: Account[]
  /** Every stored row, shadow feed included, so dedup sees all of them. */
  transactions: Transaction[]
  groups?: Record<string, GroupId>
  batches: ImportBatch[]
  incomingFile?: File | null
  onIncomingConsumed?: () => void
  onCreateAccount: (account: Account) => Promise<void>
  onCommit: (plan: ImportPlan, fingerprint?: ExportFingerprint) => Promise<void>
  onUndo: (batch: ImportBatch) => Promise<void>
  /** Set once any account has switched over to TD: the earliest switch-over date. */
  switchedFrom?: string
}

export default function ImportPanel({
  accounts,
  transactions,
  groups,
  switchedFrom,
  batches,
  incomingFile,
  onIncomingConsumed,
  onCreateAccount,
  onCommit,
  onUndo,
}: Props) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [source, setSource] = useState<File | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [removeStale, setRemoveStale] = useState(false)
  const [progress, setProgress] = useState<ImportProgressState | null>(null)
  const [creating, setCreating] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function build(name: string, text: string, registry: Account[]) {
    setError('')
    setProgress({ fileName: name, label: 'Reading the export…', percent: 20 })
    try {
      const existing = new Map(transactions.map((t) => [t.id, t]))
      setProgress({ fileName: name, label: 'Matching against what is already here…', percent: 60 })
      const next = await planImport(text, { fileName: name, accounts: registry, existing, groups })
      setProgress({ fileName: name, label: 'Almost ready…', percent: 100 })
      setFile({ name, text })
      setPlan(next)
      // A handful is the pending-charge case. Many more usually means the
      // export was filtered, so nothing is removed unless asked for.
      setRemoveStale(likelyStale(next))
    } catch (err) {
      setFile(null)
      setPlan(null)
      setError(
        err instanceof MonarchFormatError
          ? err.message
          : `That file could not be read: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setProgress(null)
    }
  }

  async function chooseFile(chosen: File) {
    setSource(chosen)
    await build(chosen.name, await chosen.text(), accounts)
  }

  useEffect(() => {
    if (!incomingFile) return
    const chosen = incomingFile
    onIncomingConsumed?.()
    void chooseFile(chosen)
  }, [incomingFile])

  async function createAccount(account: Account) {
    await onCreateAccount(account)
    setCreating(null)
    // The registry the plan was built against has changed, so build it again
    // rather than patch it — the rows for that account need real ids now.
    if (file) await build(file.name, file.text, [...accounts, account])
  }

  async function apply() {
    if (!plan) return
    setBusy(true)
    try {
      await onCommit(
        { ...plan, removed: removeStale ? (plan.stale ?? []) : [] },
        source ? fingerprintOf(source) : undefined,
      )
      setFile(null)
      setSource(null)
      setPlan(null)
    } finally {
      setBusy(false)
    }
  }

  const blocked = (plan?.unmatched.length ?? 0) > 0
  const stale = plan?.stale ?? []
  const nothingToDo =
    plan !== null &&
    plan.added.length === 0 &&
    plan.updated.length === 0 &&
    !(removeStale && stale.length > 0) &&
    (plan.linked?.length ?? 0) === 0
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.nickname ?? ''

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            Bring in a Monarch export
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            {switchedFrom
              ? `Switched over to TD from ${switchedFrom}: Monarch rows from then on are kept for comparison (Rules vs Monarch) and no longer count, except for accounts with no TD feed. `
              : 'Monarch stays the record of what happened. '}
            Import as often as you like — rows already
            here are recognised, and anything you re-categorized there is refreshed here. A
            watched folder only offers a newer file; nothing is written until you bring it in
            here.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-primary cursor-pointer text-xs">
            Choose a CSV
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const chosen = e.target.files?.[0]
                if (chosen) void chooseFile(chosen)
                e.target.value = ''
              }}
            />
          </label>
          {plan && (
            <button
              onClick={() => {
                setFile(null)
                setSource(null)
                setPlan(null)
              }}
              className="btn-ghost text-xs"
            >
              Start again
            </button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-shell-500">{error}</p>}
      </section>

      {plan && (
        <section className="card p-6">
          <header className="mb-4">
            <h2 className="text-base font-semibold tracking-tight text-ink-900">
              Here is what is in {plan.fileName}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {plan.rowsRead.toLocaleString()} rows
              {plan.firstDate && `, ${plan.firstDate} to ${plan.lastDate}`}
              {plan.skippedRows > 0 && ` · ${plan.skippedRows} line(s) without a date or amount`}
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="New" value={plan.added.length} tone="good" />
            <Stat label="Updated" value={plan.updated.length} />
            <Stat label="Already here" value={plan.unchanged} />
          </div>

          {(plan.moved ?? 0) > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              {plan.moved!.toLocaleString()} of the updates {plan.moved === 1 ? 'is a transaction' : 'are transactions'} Monarch
              re-dated, re-priced or re-worded (a pending charge that posted, say). Monarch’s own id says{' '}
              {plan.moved === 1 ? 'it is' : 'they are'} the same, so the stored copy is replaced rather than kept beside it.
            </p>
          )}
          {(plan.linked?.length ?? 0) > 0 && plan.added.length === 0 && plan.updated.length === 0 && (
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              Nothing changed, but bringing it in notes Monarch’s own id on {plan.linked!.length.toLocaleString()} rows, so a
              charge Monarch later re-dates is recognised as the same one.
            </p>
          )}
          {plan.internal > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              {plan.internal.toLocaleString()} of these are transfers or card payments. They are
              kept, and stay visible in your accounts, but they are left out of income and spending
              totals because they move money rather than spend it.
            </p>
          )}

          {plan.months.length > 0 && (
            <p className="mt-2 text-xs text-ink-400">
              Touches {plan.months.length} month{plan.months.length === 1 ? '' : 's'}:{' '}
              {plan.months.map(monthLabel).join(', ')}
            </p>
          )}

          {stale.length > 0 && (
            <div className="mt-5 rounded-2xl border border-sand-200 bg-sand-100/60 px-4 py-3.5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={removeStale}
                  onChange={(e) => setRemoveStale(e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">
                    Remove {stale.length} row{stale.length === 1 ? '' : 's'} no longer in Monarch
                  </span>
                  <span className="block text-xs text-ink-500">
                    Already here from an earlier import, inside this file’s dates and accounts, but gone from
                    Monarch — usually a pending charge Monarch re-dated or re-priced when it posted, or a
                    purchase it re-split. The new version is in this file, so keeping both counts it twice.
                    {!likelyStale(plan) &&
                      ' That is a lot for one export — if it was filtered (one account, one category), leave this unticked.'}{' '}
                    Undo under Past imports puts them back.
                  </span>
                </span>
              </label>
              <ul className="mt-2 max-h-48 divide-y divide-sand-200/80 overflow-y-auto pl-7 text-xs">
                {stale.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3 py-1">
                    <span className="min-w-0 truncate text-ink-700">
                      <span className="tabular-nums text-ink-400">{row.date}</span> · {row.merchant} ·{' '}
                      {row.category} · {accountName(row.accountId)}
                    </span>
                    <span className="tabular-nums text-ink-700">{amountIn(row.amount, row.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocked && (
            <div className="mt-5 rounded-2xl border border-shell-300/50 bg-shell-300/10 px-4 py-3.5">
              <p className="text-sm font-medium text-ink-900">
                {plan.unmatched.length} account{plan.unmatched.length === 1 ? '' : 's'} not
                recognised
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Their rows are set aside until you say what they are. Currency matters most: it
                decides whether their amounts join your CAD totals or stay separate. “What you
                call it” starts as the Monarch name; you can keep it or change it.
              </p>
              <ul className="mt-3 space-y-2">
                {plan.unmatched.map((account) => (
                  <li
                    key={account.monarchName}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-900">{account.monarchName}</p>
                      <p className="text-xs text-ink-400">
                        {account.rows.toLocaleString()} rows · e.g. {account.sample}
                      </p>
                    </div>
                    <button
                      onClick={() => setCreating(blankAccount(account.monarchName))}
                      className="btn-ghost shrink-0 text-xs"
                    >
                      Set it up
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {nothingToDo && !blocked && (
              <span className="mr-auto text-xs text-ink-500">
                Everything in this file is already here.
              </span>
            )}
            <button
              onClick={() => void apply()}
              className="btn-primary"
              disabled={busy || blocked || nothingToDo}
            >
              {busy ? 'Saving…' : 'Bring these in'}
            </button>
          </div>
        </section>
      )}

      {batches.length > 0 && (
        <section className="card p-6">
          <header className="mb-4">
            <h2 className="text-base font-semibold tracking-tight text-ink-900">Past imports</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Undoing one puts the store back exactly as it was, including anything that import
              overwrote.
            </p>
          </header>
          <ul className="space-y-2">
            {batches.map((batch) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{batch.fileName}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(batch.importedAt).toLocaleString()} ·{' '}
                    {(batch.addedIds.length - (batch.moved ?? 0)).toLocaleString()} new,{' '}
                    {(batch.replaced.length - (batch.removedIds?.length ?? 0)).toLocaleString()} updated
                    {(batch.removedIds?.length ?? 0) > 0 && `, ${batch.removedIds!.length.toLocaleString()} removed`}
                  </p>
                </div>
                <button onClick={() => void onUndo(batch)} className="btn-ghost shrink-0 text-xs">
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {creating && (
        <AccountForm
          account={creating}
          existing={accounts}
          onClose={() => setCreating(null)}
          onSave={(account) => void createAccount(account)}
        />
      )}

      {progress && <ImportProgress progress={progress} />}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'good' && value > 0 ? 'text-tide-700' : 'text-ink-900'
        }`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

/** Few enough, against the size of the export, to be pending charges that posted rather than a filtered export. */
function likelyStale(plan: ImportPlan): boolean {
  const count = plan.stale?.length ?? 0
  return count > 0 && count <= 25 && count <= Math.max(3, plan.rowsRead * 0.05)
}
