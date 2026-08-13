import { useState } from 'react'
import Modal from '../Modal'
import { uid } from '../../lib/format'
import type { ManualEntry } from '../../lib/etm/manual'
import type { Account } from '../../lib/etm/types'

interface Props {
  accounts: Account[]
  onClose: () => void
  onSave: (entry: ManualEntry, account: Account) => Promise<void>
  onCreateAccount: (account: Account) => Promise<void>
}

/** Cash and anything else no export knows about. */
export default function ManualEntryForm({ accounts, onClose, onSave, onCreateAccount }: Props) {
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
      mainCard: false,
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
