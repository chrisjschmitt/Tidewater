import { useState } from 'react'
import Modal from '../Modal'
import { uid } from '../../lib/format'
import { amountIn } from '../../lib/etm/format'
import {
  ACCOUNT_KIND_LABELS,
  CURRENCIES,
  type Account,
  type AccountKind,
  type Currency,
} from '../../lib/etm/types'

interface Props {
  accounts: Account[]
  /** Monarch account strings seen in imports, offered as matching hints. */
  onSave: (account: Account) => void
  onDelete: (account: Account) => void
  transactionCounts: Map<string, number>
}

export default function AccountsPanel({ accounts, onSave, onDelete, transactionCounts }: Props) {
  const [editing, setEditing] = useState<Account | null>(null)

  return (
    <section className="card p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Your accounts</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            What each account means is yours to say. The Monarch name is how imported rows find
            their way here.
          </p>
        </div>
        <button onClick={() => setEditing(blankAccount())} className="btn-primary text-xs">
          Add an account
        </button>
      </header>

      {accounts.length === 0 ? (
        <p className="rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-ink-500">
          No accounts yet. Add one, or start an import and let it offer to create the accounts it
          finds.
        </p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                  {account.nickname}
                  {account.lastFour && (
                    <span className="text-xs font-normal text-ink-400">••{account.lastFour}</span>
                  )}
                  {account.currency === 'USD' && <Pill>USD</Pill>}
                  {account.funding && <Pill>Funding</Pill>}
                  {account.mainCard && <Pill>Main card</Pill>}
                  {account.savingsDestination && <Pill>Savings</Pill>}
                  {account.excludedFromBudget && <Pill>Outside the budget</Pill>}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {ACCOUNT_KIND_LABELS[account.kind]}
                  {account.monarchName ? ` · matches “${account.monarchName}”` : ' · no Monarch name'}
                  {account.float ? ` · keeps ${amountIn(account.float, account.currency)}` : ''}
                  {` · ${(transactionCounts.get(account.id) ?? 0).toLocaleString()} transactions`}
                </p>
              </div>
              <button onClick={() => setEditing(account)} className="btn-ghost shrink-0 text-xs">
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AccountForm
          account={editing}
          existing={accounts}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            onSave(next)
            setEditing(null)
          }}
          onDelete={
            accounts.some((a) => a.id === editing.id)
              ? () => {
                  onDelete(editing)
                  setEditing(null)
                }
              : undefined
          }
        />
      )}
    </section>
  )
}

const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-tide-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-tide-700">
    {children}
  </span>
)

export function blankAccount(monarchName = ''): Account {
  return {
    id: uid('acct'),
    nickname: '',
    kind: 'chequing',
    currency: 'CAD',
    monarchName,
    funding: false,
    mainCard: false,
    savingsDestination: false,
    excludedFromBudget: false,
  }
}

export function AccountForm({
  account,
  existing,
  onClose,
  onSave,
  onDelete,
}: {
  account: Account
  existing: Account[]
  onClose: () => void
  onSave: (account: Account) => void
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState(account)
  const [error, setError] = useState('')
  const isNew = !existing.some((a) => a.id === account.id)

  const set = <K extends keyof Account>(field: K, value: Account[K]) =>
    setDraft((d) => ({ ...d, [field]: value }))

  function submit() {
    const nickname = draft.nickname.trim()
    if (!nickname) {
      setError('Please give the account a name you will recognise.')
      return
    }
    const monarchName = draft.monarchName.trim()
    const clash = existing.find(
      (a) => a.id !== draft.id && monarchName && a.monarchName.toLowerCase() === monarchName.toLowerCase(),
    )
    if (clash) {
      setError(`“${clash.nickname}” already matches that Monarch name.`)
      return
    }
    onSave({ ...draft, nickname, monarchName, lastFour: draft.lastFour?.trim() || undefined })
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-lg"
      title={isNew ? 'Add an account' : draft.nickname || 'Edit account'}
      subtitle="Nothing here leaves this device, and full account numbers are never asked for."
      footer={
        <div className="flex items-center justify-between gap-2">
          {onDelete ? (
            <button onClick={onDelete} className="btn-quiet text-xs text-shell-500">
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button onClick={submit} className="btn-primary">
              Save
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="What you call it">
          <input
            autoFocus
            className="field"
            value={draft.nickname}
            placeholder="Everyday spending"
            onChange={(e) => set('nickname', e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            <select
              className="field"
              value={draft.kind}
              onChange={(e) => set('kind', e.target.value as AccountKind)}
            >
              {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Currency" hint="Tracked as-is; never converted.">
            <select
              className="field"
              value={draft.currency}
              onChange={(e) => set('currency', e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Last four" hint="Display only, and optional.">
            <input
              className="field"
              inputMode="numeric"
              maxLength={4}
              value={draft.lastFour ?? ''}
              onChange={(e) => set('lastFour', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Name in Monarch" hint="Copy it exactly as the export writes it.">
            <input
              className="field"
              value={draft.monarchName}
              placeholder="Chequing (...1001)"
              onChange={(e) => set('monarchName', e.target.value)}
            />
          </Field>
        </div>

        <fieldset className="space-y-2 rounded-2xl bg-white/70 px-4 py-3.5">
          <legend className="label">What it does</legend>
          <Check
            label="Everything is paid from this account"
            checked={draft.funding}
            onChange={(v) => set('funding', v)}
          />
          <Check
            label="Everyday purchases go on this card, cleared each month"
            checked={draft.mainCard}
            onChange={(v) => set('mainCard', v)}
          />
          <Check
            label="Surplus is transferred here"
            checked={draft.savingsDestination}
            onChange={(v) => set('savingsDestination', v)}
          />
          <Check
            label="Kept out of the family budget"
            checked={draft.excludedFromBudget}
            onChange={(v) => set('excludedFromBudget', v)}
          />
          {draft.funding && (
            <div className="pt-1">
              <Field label="Balance to leave in it" hint="Used by the monthly savings figure.">
                <input
                  className="field"
                  inputMode="numeric"
                  value={draft.float ?? ''}
                  onChange={(e) => {
                    const value = Number(e.target.value.replace(/[^0-9.]/g, ''))
                    set('float', Number.isFinite(value) && value > 0 ? value : undefined)
                  }}
                />
              </Field>
            </div>
          )}
        </fieldset>

        {error && <p className="text-sm text-shell-500">{error}</p>}
      </div>
    </Modal>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="label mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-ink-700">
      <input
        type="checkbox"
        className="h-4 w-4 accent-tide-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}
