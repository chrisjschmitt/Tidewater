import { useMemo, useState } from 'react'
import ManualEntryForm from './ManualEntryForm'
import { GROUPS, GROUP_BY_ID } from '../../lib/categories'
import {
  filterTransactions,
  isReimbursable,
  negate,
  noFilters,
  presentIn,
  sumOf,
  type Money,
  type TransactionFilters,
} from '../../lib/etm/aggregate'
import { amountIn } from '../../lib/etm/format'
import { createManualTransaction } from '../../lib/etm/manual'
import { periodLabel, type Period } from '../../lib/etm/period'
import type { Account, Transaction } from '../../lib/etm/types'
import type { GroupId } from '../../lib/types'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  period: Period
  /** Marked, never hidden: this view is the whole record (§5). */
  reimbursableTag: string
  onAddManual: (transaction: Transaction) => Promise<void>
  onRemove: (transaction: Transaction) => Promise<void>
  onCreateAccount: (account: Account) => Promise<void>
}

/** Beyond this the table is paged, so a decade of history never stalls the view. */
const PAGE = 250

export default function TransactionsPanel({
  accounts,
  transactions,
  period,
  reimbursableTag,
  onAddManual,
  onRemove,
  onCreateAccount,
}: Props) {
  const [filters, setFilters] = useState<TransactionFilters>(noFilters)
  const [shown, setShown] = useState(PAGE)
  const [adding, setAdding] = useState(false)

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const choices = useMemo(() => optionsFrom(transactions), [transactions])

  const rows = useMemo(
    () => filterTransactions(transactions, period, filters),
    [transactions, period, filters],
  )

  const totals = useMemo(() => {
    const inbound = sumOf(rows.filter((t) => t.amount > 0))
    const outbound = sumOf(rows.filter((t) => t.amount < 0))
    return { inbound, outbound: negate(outbound), net: sumOf(rows) }
  }, [rows])

  const set = <K extends keyof TransactionFilters>(field: K, value: TransactionFilters[K]) => {
    setFilters((f) => ({ ...f, [field]: value }))
    setShown(PAGE)
  }

  const touched = JSON.stringify(filters) !== JSON.stringify(noFilters())

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink-900">Transactions</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {periodLabel(period)} · {rows.length.toLocaleString()} of{' '}
              {transactions.length.toLocaleString()}. Every total below follows these filters.
            </p>
          </div>
          <button onClick={() => setAdding(true)} className="btn-primary text-xs">
            Add cash spending
          </button>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <Totals label="Money in" money={totals.inbound} />
          <Totals label="Money out" money={totals.outbound} />
          <Totals label="Net" money={totals.net} signed />
        </div>
      </section>

      <section className="card p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="label mb-1.5">Search</span>
            <input
              className="field"
              placeholder="Merchant, statement or note"
              value={filters.text}
              onChange={(e) => set('text', e.target.value)}
            />
          </label>

          <Picker
            label="Account"
            value={filters.accountIds[0] ?? ''}
            onChange={(v) => set('accountIds', v ? [v] : [])}
            options={accounts.map((a) => [a.id, a.nickname])}
          />
          <Picker
            label="Group"
            value={filters.groupIds[0] ?? ''}
            onChange={(v) => set('groupIds', v ? [v as GroupId] : [])}
            options={GROUPS.map((g) => [g.id, g.name])}
          />
          <Picker
            label="Category"
            value={filters.categories[0] ?? ''}
            onChange={(v) => set('categories', v ? [v] : [])}
            options={choices.categories.map((c) => [c, c])}
          />
          <Picker
            label="Tag"
            value={filters.tags[0] ?? ''}
            onChange={(v) => set('tags', v ? [v] : [])}
            options={choices.tags.map((t) => [t, t])}
          />
          <Picker
            label="Whose"
            value={filters.owners[0] ?? ''}
            onChange={(v) => set('owners', v ? [v] : [])}
            options={choices.owners.map((o) => [o, o])}
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label mb-1.5">At least</span>
              <input
                className="field"
                inputMode="decimal"
                placeholder="0"
                value={filters.minAmount ?? ''}
                onChange={(e) => set('minAmount', numberOrNull(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="label mb-1.5">At most</span>
              <input
                className="field"
                inputMode="decimal"
                placeholder="Any"
                value={filters.maxAmount ?? ''}
                onChange={(e) => set('maxAmount', numberOrNull(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={filters.includeInternal}
              onChange={(e) => set('includeInternal', e.target.checked)}
              className="h-4 w-4 rounded border-sand-300 text-tide-600 focus:ring-tide-500/30"
            />
            Include transfers and card payments
          </label>
          {touched && (
            <button
              onClick={() => {
                setFilters(noFilters())
                setShown(PAGE)
              }}
              className="btn-quiet text-xs"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      <section className="card overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-ink-500">
            Nothing matches. Widen the period or clear a filter.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sand-100/70 text-xs text-ink-500">
                  <tr>
                    <Th>Date</Th>
                    <Th>What</Th>
                    <Th>Category</Th>
                    <Th>Account</Th>
                    <Th>Whose</Th>
                    <Th right>Amount</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-200">
                  {rows.slice(0, shown).map((t) => (
                    <tr key={t.id} className="transition hover:bg-sand-100/50">
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-xs text-ink-500">
                        {t.date}
                      </td>
                      <td className="max-w-xs px-4 py-2.5">
                        <span className="flex items-center gap-2 truncate text-ink-900">
                          {t.merchant || t.originalStatement || t.category}
                          {t.source === 'manual' && <Tag>Cash</Tag>}
                          {t.internal && <Tag>Internal</Tag>}
                          {isReimbursable(t, reimbursableTag) && <Tag>Reimbursable</Tag>}
                        </span>
                        {(t.notes || t.tags.length > 0) && (
                          <span className="block truncate text-xs text-ink-400">
                            {[t.notes, ...t.tags].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">
                        {t.category}
                        {!t.internal && (
                          <span className="block text-ink-400">{GROUP_BY_ID[t.groupId].name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">
                        {accountsById.get(t.accountId)?.nickname ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">{t.owner || '—'}</td>
                      <td
                        className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${
                          t.amount > 0 ? 'text-tide-700' : 'text-ink-900'
                        }`}
                      >
                        {amountIn(t.amount, t.currency)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {t.source === 'manual' && (
                          <button
                            onClick={() => void onRemove(t)}
                            className="text-xs text-ink-400 transition hover:text-shell-500"
                            aria-label={`Remove ${t.merchant}`}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length > shown && (
              <div className="border-t border-sand-200 px-6 py-4 text-center">
                <button onClick={() => setShown((s) => s + PAGE)} className="btn-ghost text-xs">
                  Show {Math.min(PAGE, rows.length - shown).toLocaleString()} more
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {adding && (
        <ManualEntryForm
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

function Totals({ label, money, signed = false }: { label: string; money: Money; signed?: boolean }) {
  const parts = presentIn(money)
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      {parts.length === 0 ? (
        <p className="mt-1 text-lg font-semibold text-ink-400">—</p>
      ) : (
        parts.map(([currency, value]) => (
          <p
            key={currency}
            className={`mt-1 text-lg font-semibold tabular-nums ${
              signed && value < 0 ? 'text-shell-500' : 'text-ink-900'
            }`}
          >
            {amountIn(signed ? value : Math.abs(value), currency)}
            {parts.length > 1 && (
              <span className="ml-1.5 text-xs font-normal text-ink-400">{currency}</span>
            )}
          </p>
        ))
      )}
    </div>
  )
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <label className="block">
      <span className="label mb-1.5">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

const Th = ({ children, right = false }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={`px-4 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>
)

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
    {children}
  </span>
)

function numberOrNull(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  return cleaned === '' ? null : Number(cleaned)
}

/** Only offer filters the data can actually satisfy. */
function optionsFrom(transactions: Transaction[]) {
  const categories = new Set<string>()
  const tags = new Set<string>()
  const owners = new Set<string>()
  for (const t of transactions) {
    if (t.category) categories.add(t.category)
    for (const tag of t.tags) tags.add(tag)
    if (t.owner) owners.add(t.owner)
  }
  const sorted = (set: Set<string>) => [...set].sort((a, z) => a.localeCompare(z))
  return { categories: sorted(categories), tags: sorted(tags), owners: sorted(owners) }
}
