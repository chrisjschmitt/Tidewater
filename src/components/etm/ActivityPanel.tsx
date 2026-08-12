import { useMemo, useState } from 'react'
import Modal from '../Modal'
import { uid } from '../../lib/format'
import { GROUP_BY_ID } from '../../lib/categories'
import { amountIn, totalsByCurrency } from '../../lib/etm/format'
import { createManualTransaction, type ManualEntry } from '../../lib/etm/manual'
import type { Account, Transaction } from '../../lib/etm/types'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  onAddManual: (transaction: Transaction) => Promise<void>
  onRemove: (transaction: Transaction) => Promise<void>
  onCreateAccount: (account: Account) => Promise<void>
}

const SHOWN = 60

/**
 * A plain recent-activity list. The filterable view with drill-down and
 * subtotals is Phase 3; this exists so imports and cash entries can be seen
 * landing.
 */
export default function ActivityPanel({
  accounts,
  transactions,
  onAddManual,
  onRemove,
  onCreateAccount,
}: Props) {
  const [adding, setAdding] = useState(false)
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const spend = transactions.filter((t) => !t.internal && t.amount < 0)
  const income = transactions.filter((t) => !t.internal && t.amount > 0)

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink-900">
              Everything so far
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {transactions.length.toLocaleString()} transactions, transfers and card payments
              included.
            </p>
          </div>
          <button onClick={() => setAdding(true)} className="btn-primary text-xs">
            Add cash spending
          </button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <Totals label="Money in" rows={income} />
          <Totals label="Money out" rows={spend} />
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Most recent</h2>
        {transactions.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-ink-500">
            Nothing yet. Import a Monarch export, or add a cash purchase by hand.
          </p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-sand-200">
              {transactions.slice(0, SHOWN).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm text-ink-900">
                      {t.merchant || t.originalStatement || t.category}
                      {t.source === 'manual' && (
                        <span className="rounded-full bg-sand-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
                          Cash
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-400">
                      {t.date} · {t.category}
                      {!t.internal && ` · ${GROUP_BY_ID[t.groupId].name}`}
                      {t.internal && ' · internal movement'}
                      {byId.get(t.accountId) && ` · ${byId.get(t.accountId)!.nickname}`}
                      {t.tags.length > 0 && ` · ${t.tags.join(', ')}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`tabular-nums text-sm ${
                        t.amount > 0 ? 'text-tide-700' : 'text-ink-700'
                      }`}
                    >
                      {amountIn(t.amount, t.currency)}
                    </span>
                    {t.source === 'manual' && (
                      <button
                        onClick={() => void onRemove(t)}
                        className="text-xs text-ink-400 transition hover:text-shell-500"
                        aria-label={`Remove ${t.merchant}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {transactions.length > SHOWN && (
              <p className="mt-4 text-xs text-ink-400">
                Showing the {SHOWN} most recent of {transactions.length.toLocaleString()}. The full
                filterable view comes next.
              </p>
            )}
          </>
        )}
      </section>

      {adding && (
        <ManualForm
          accounts={accounts}
          onClose={() => setAdding(false)}
          onCreateAccount={onCreateAccount}
          onSave={async (entry, account) => {
            await onAddManual(createManualTransaction(entry, account))
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function Totals({ label, rows }: { label: string; rows: Transaction[] }) {
  const totals = totalsByCurrency(rows)
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      {totals.length === 0 ? (
        <p className="mt-1 text-lg font-semibold text-ink-400">—</p>
      ) : (
        totals.map(([currency, total]) => (
          <p key={currency} className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
            {amountIn(Math.abs(total), currency)}
            {totals.length > 1 && (
              <span className="ml-1.5 text-xs font-normal text-ink-400">{currency}</span>
            )}
          </p>
        ))
      )}
    </div>
  )
}

function ManualForm({
  accounts,
  onClose,
  onSave,
  onCreateAccount,
}: {
  accounts: Account[]
  onClose: () => void
  onSave: (entry: ManualEntry, account: Account) => Promise<void>
  onCreateAccount: (account: Account) => Promise<void>
}) {
  const [entry, setEntry] = useState<ManualEntry>({
    date: new Date().toISOString().slice(0, 10),
    merchant: '',
    category: '',
    amount: 0,
    spend: true,
    notes: '',
    tags: [],
    owner: '',
  })
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [tagText, setTagText] = useState('')
  const [error, setError] = useState('')

  const hasCash = accounts.some((a) => /cash/i.test(a.nickname))
  const set = <K extends keyof ManualEntry>(field: K, value: ManualEntry[K]) =>
    setEntry((e) => ({ ...e, [field]: value }))

  async function addCashAccount() {
    const account: Account = {
      id: uid('acct'),
      nickname: 'Cash',
      kind: 'chequing',
      currency: 'CAD',
      monarchName: '',
      funding: false,
      savingsDestination: false,
      excludedFromBudget: false,
    }
    await onCreateAccount(account)
    setAccountId(account.id)
  }

  async function submit() {
    const account = accounts.find((a) => a.id === accountId)
    if (!account) {
      setError('Choose which account this came out of.')
      return
    }
    if (!entry.merchant.trim()) {
      setError('What was it for?')
      return
    }
    if (!(entry.amount > 0)) {
      setError('Enter an amount.')
      return
    }
    await onSave(
      { ...entry, tags: tagText.split(',').map((t) => t.trim()).filter(Boolean) },
      account,
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-lg"
      title="Add cash spending"
      subtitle="For what no export knows about. It is kept apart from imported rows and never overwritten."
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={() => void submit()} className="btn-primary">
            Add it
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {accounts.length === 0 ? (
          <div className="rounded-2xl bg-white/70 px-4 py-3.5">
            <p className="text-sm text-ink-900">There is nowhere to put this yet.</p>
            <p className="mt-0.5 text-xs text-ink-500">
              Every transaction belongs to an account, so totals and reconciliation always add up.
            </p>
            <button onClick={() => void addCashAccount()} className="btn-ghost mt-3 text-xs">
              Create a “Cash” account
            </button>
          </div>
        ) : (
          <label className="block">
            <span className="label mb-1.5">Account</span>
            <select
              className="field"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname} ({a.currency})
                </option>
              ))}
            </select>
            {!hasCash && (
              <button onClick={() => void addCashAccount()} className="btn-quiet mt-2 text-xs">
                Or create a “Cash” account
              </button>
            )}
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5">Date</span>
            <input
              type="date"
              className="field"
              value={entry.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label mb-1.5">Amount</span>
            <input
              className="field"
              inputMode="decimal"
              value={entry.amount || ''}
              onChange={(e) => set('amount', Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
            />
          </label>
        </div>

        <div className="flex gap-2">
          {(
            [
              [true, 'Money out'],
              [false, 'Money in'],
            ] as const
          ).map(([spend, label]) => (
            <button
              key={label}
              onClick={() => set('spend', spend)}
              className={entry.spend === spend ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5">What it was</span>
            <input
              className="field"
              placeholder="Farmers market"
              value={entry.merchant}
              onChange={(e) => set('merchant', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label mb-1.5">Category</span>
            <input
              className="field"
              placeholder="Groceries"
              value={entry.category}
              onChange={(e) => set('category', e.target.value)}
            />
            <span className="mt-1 block text-xs text-ink-400">
              Use the same wording as Monarch and it will group the same way.
            </span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1.5">Tags</span>
            <input
              className="field"
              placeholder="Reimbursable"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label mb-1.5">Whose</span>
            <input
              className="field"
              value={entry.owner}
              onChange={(e) => set('owner', e.target.value)}
            />
          </label>
        </div>

        {error && <p className="text-sm text-shell-500">{error}</p>}
      </div>
    </Modal>
  )
}
