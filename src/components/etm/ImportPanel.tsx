import { useRef, useState } from 'react'
import ImportProgress, { type ImportProgressState } from '../ImportProgress'
import { AccountForm, blankAccount } from './AccountsPanel'
import { planImport, type ImportPlan } from '../../lib/etm/importer'
import { MonarchFormatError } from '../../lib/etm/monarch'
import { monthLabel } from '../../lib/etm/format'
import type { Account, ImportBatch, Transaction } from '../../lib/etm/types'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  batches: ImportBatch[]
  onCreateAccount: (account: Account) => Promise<void>
  onCommit: (plan: ImportPlan) => Promise<void>
  onUndo: (batch: ImportBatch) => Promise<void>
}

export default function ImportPanel({
  accounts,
  transactions,
  batches,
  onCreateAccount,
  onCommit,
  onUndo,
}: Props) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [progress, setProgress] = useState<ImportProgressState | null>(null)
  const [creating, setCreating] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function build(name: string, text: string, registry: Account[]) {
    setError('')
    setProgress({ fileName: name, label: 'Reading the export…', percent: 20 })
    try {
      const existing = new Map(transactions.map((t) => [t.id, t]))
      setProgress({ fileName: name, label: 'Matching against what is already here…', percent: 60 })
      const next = await planImport(text, { fileName: name, accounts: registry, existing })
      setProgress({ fileName: name, label: 'Almost ready…', percent: 100 })
      setFile({ name, text })
      setPlan(next)
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
    await build(chosen.name, await chosen.text(), accounts)
  }

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
      await onCommit(plan)
      setFile(null)
      setPlan(null)
    } finally {
      setBusy(false)
    }
  }

  const blocked = (plan?.unmatched.length ?? 0) > 0
  const nothingToDo = plan !== null && plan.added.length === 0 && plan.updated.length === 0

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            Bring in a Monarch export
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            Monarch stays the record of what happened. Import as often as you like — rows already
            here are recognised, and anything you re-categorized there is refreshed here.
          </p>
        </header>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0]
            if (chosen) void chooseFile(chosen)
            e.target.value = ''
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="btn-primary text-xs">
            Choose a CSV
          </button>
          {plan && (
            <button
              onClick={() => {
                setFile(null)
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

          {blocked && (
            <div className="mt-5 rounded-2xl border border-shell-300/50 bg-shell-300/10 px-4 py-3.5">
              <p className="text-sm font-medium text-ink-900">
                {plan.unmatched.length} account{plan.unmatched.length === 1 ? '' : 's'} not
                recognised
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Their rows are set aside until you say what they are. Currency matters most: it
                decides whether their amounts join your CAD totals or stay separate.
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
                    {batch.addedIds.length.toLocaleString()} new,{' '}
                    {batch.replaced.length.toLocaleString()} updated
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
