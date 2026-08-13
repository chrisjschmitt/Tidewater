import { useMemo, useState } from 'react'
import BalanceForm from './BalanceForm'
import TransactionTable from './TransactionTable'
import type { EtmData } from './useEtmData'
import { presentIn } from '../../lib/etm/aggregate'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import {
  closingFor,
  computeSavings,
  findUntidy,
  reconcile,
  reimbursementPivot,
  type PivotRow,
  type Reconciliation,
  type Savings,
} from '../../lib/etm/workflow'
import type { Account, ReconciliationRecord, SettledTransfer } from '../../lib/etm/types'

interface Props {
  data: EtmData
  month: string
  onMonthChange: (month: string) => void
}

/**
 * The monthly cycle as a checklist. It computes and explains; it never moves
 * money, and nothing here is required — a month can be closed, left open, or
 * ignored entirely, and the rest of the module carries on regardless.
 */
export default function WorkflowPanel({ data, month, onMonthChange }: Props) {
  const record = data.reconciliations.find((r) => r.month === month)
  const closed = record?.status === 'reconciled'

  const asOf = endOf(month)
  const savings = useMemo(
    () => computeSavings(data.accounts, data.balances, asOf),
    [data.accounts, data.balances, asOf],
  )
  const untidy = useMemo(
    () => findUntidy(data.transactions, data.accounts, month, data.config),
    [data.transactions, data.accounts, month, data.config],
  )
  const pivot = useMemo(
    () =>
      reimbursementPivot(data.transactions, month, data.config, {
        settled: record?.settled ?? [],
      }),
    [data.transactions, month, data.config, record],
  )
  const reconciliation = useMemo(
    () =>
      reconcile(
        data.transactions,
        data.accounts,
        data.balances,
        month,
        data.config.tolerance,
      ),
    [data.transactions, data.accounts, data.balances, month, data.config.tolerance],
  )

  const save = (changes: Partial<ReconciliationRecord>) =>
    void data.recordMonth({
      month,
      status: 'open',
      settled: record?.settled ?? [],
      residual: reconciliation.residual,
      notes: record?.notes ?? '',
      ...changes,
    })

  return (
    <div className="space-y-6">
      <YearStrip
        year={month.slice(0, 4)}
        selected={month}
        data={data}
        onSelect={onMonthChange}
      />

      <Step
        n={1}
        title="Tidy"
        blurb="Import the latest Monarch export, then sort out anything still missing — the claims in step two are only as good as the tags underneath them."
      >
        <Tidy untidy={untidy} tag={data.config.reimbursableTag} />
      </Step>

      <Step
        n={2}
        title="Reimbursements"
        blurb="What to ask for, and from whom. Worth doing a business day before the month ends, so the repayments land inside it. Recording a transfer only notes that you asked — nothing moves here."
      >
        <Pivot
          rows={pivot}
          transactions={data.transactions}
          onSettle={(row, settled) => {
            const kept = (record?.settled ?? []).filter(
              (s) => !(s.bucket === row.bucket && s.currency === row.currency),
            )
            const next: SettledTransfer[] = settled
              ? [
                  ...kept,
                  {
                    bucket: row.bucket,
                    owedBy: row.owedBy,
                    amount: row.amount,
                    currency: row.currency,
                    recordedAt: new Date().toISOString(),
                  },
                ]
              : kept
            save({ settled: next, status: record?.status ?? 'open' })
          }}
        />
      </Step>

      <Step
        n={3}
        title="Closing balances"
        blurb="Once the month is over, record what each account closed at. A statement CSV supplies the figure; nothing inside it is read as transactions."
      >
        <Balances data={data} month={month} />
      </Step>

      <Step
        n={4}
        title="Monthly savings"
        blurb="What is free to move once the float is left behind and the cards are cleared."
      >
        <SavingsStep savings={savings} accounts={data.accounts} />
      </Step>

      <Step
        n={5}
        title="Reconcile"
        blurb="What the balances say, against what the transactions say. Then close the month."
      >
        <Reconcile
          reconciliation={reconciliation}
          tolerance={data.config.tolerance}
          onToleranceChange={(tolerance) => void data.saveSettings({ ...data.config, tolerance })}
          closed={closed}
          closedAt={record?.closedAt}
          onClose={() =>
            save({
              status: 'reconciled',
              closedAt: new Date().toISOString(),
              savings: savings.total,
              residual: reconciliation.residual,
            })
          }
          onReopen={() => void data.reopenMonth(month)}
        />
      </Step>
    </div>
  )
}

// --- the year ---------------------------------------------------------------

function YearStrip({
  year,
  selected,
  data,
  onSelect,
}: {
  year: string
  selected: string
  data: EtmData
  onSelect: (month: string) => void
}) {
  const years = useMemo(() => {
    const seen = new Set(data.months.map((m) => m.slice(0, 4)))
    seen.add(year)
    return [...seen].sort()
  }, [data.months, year])

  const closedCount = data.reconciliations.filter(
    (r) => r.month.startsWith(year) && r.status === 'reconciled',
  ).length

  return (
    <section className="card p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">The year</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {closedCount} of twelve months closed. Pick one to work on.
          </p>
        </div>
        {years.length > 1 && (
          <div className="flex gap-1">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => onSelect(`${y}-${selected.slice(5, 7)}`)}
                className={
                  y === year
                    ? 'rounded-full bg-tide-600 px-3 py-1 text-xs font-medium text-white'
                    : 'btn-quiet text-xs'
                }
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`
          const status = data.reconciliations.find((r) => r.month === key)?.status
          const has = data.months.includes(key)
          const isSelected = key === selected
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={`rounded-2xl px-3 py-2.5 text-left transition ${
                isSelected ? 'bg-tide-600 text-white' : 'bg-white/70 hover:bg-sand-100'
              }`}
            >
              <span className="block text-sm font-medium">{monthName(key).split(' ')[0]}</span>
              <span
                className={`block text-[11px] ${isSelected ? 'text-white/70' : 'text-ink-400'}`}
              >
                {status === 'reconciled' ? 'Closed' : has ? 'Open' : 'No data'}
              </span>
            </button>
          )
        })}
      </div>

      {data.config.annualEvents.filter((e) => e.month === selected.slice(5, 7)).length > 0 && (
        <ul className="mt-4 space-y-1">
          {data.config.annualEvents
            .filter((e) => e.month === selected.slice(5, 7))
            .map((event) => (
              <li key={event.id} className="text-xs text-ink-500">
                Once a year, this month: {event.label}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}

// --- steps ------------------------------------------------------------------

function Step({
  n,
  title,
  blurb,
  children,
}: {
  n: number
  title: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <section className="card p-6">
      <header className="mb-4 flex gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tide-50 text-[11px] font-semibold text-tide-700">
          {n}
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">{blurb}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function Balances({ data, month }: { data: EtmData; month: string }) {
  const [editing, setEditing] = useState<Account | null>(null)
  const anchors = data.accounts.filter((a) => a.funding || a.mainCard || a.kind !== 'chequing')

  if (data.accounts.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        Add your accounts first, on the Accounts tab, and mark which one pays for
        everything and which card you clear each month.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {anchors.map((account) => {
        const closing = closingFor(data.balances, account.id, month)
        return (
          <div key={account.id} className="rounded-2xl bg-white/70 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {account.nickname}
                  {account.funding && <Tag>Funding</Tag>}
                  {account.mainCard && <Tag>Main card</Tag>}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {closing
                    ? `${amountIn(closing.balance, account.currency)} as of ${closing.date}${
                        closing.pending ? ` · ${amountIn(closing.pending, account.currency)} pending` : ''
                      }${closing.source === 'statement' ? ' · from a statement' : ''}`
                    : 'No balance recorded for this month'}
                </span>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(editing?.id === account.id ? null : account)}
                  className="btn-ghost text-xs"
                >
                  {closing ? 'Change' : 'Record'}
                </button>
                {closing && (
                  <button
                    onClick={() => void data.removeBalance(closing)}
                    className="btn-quiet text-xs"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {editing?.id === account.id && (
              <div className="mt-3 animate-fade">
                <BalanceForm
                  account={account}
                  month={month}
                  {...(closing ? { existing: closing } : {})}
                  onSave={(snapshot) => void data.recordBalance(snapshot)}
                  onClose={() => setEditing(null)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Tidy({ untidy, tag }: { untidy: ReturnType<typeof findUntidy>; tag: string }) {
  const nothing =
    untidy.uncategorized.length === 0 && untidy.untaggedCandidates.length === 0

  if (nothing) {
    return (
      <p className="text-sm text-ink-500">
        Everything this month is categorized, and nothing on a reimbursement-only
        card is missing its tag. Nothing to do here.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {untidy.uncategorized.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink-900">
            {untidy.uncategorized.length} uncategorized{' '}
            {untidy.uncategorized.length === 1 ? 'row' : 'rows'}
          </p>
          <p className="mb-2 text-xs text-ink-400">
            Categorize these in Monarch and import again — Monarch stays the
            source of record, so a change here would be overwritten.
          </p>
          <TransactionTable rows={untidy.uncategorized.slice(0, 10)} empty="" />
        </div>
      )}

      {untidy.untaggedCandidates.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink-900">
            {untidy.untaggedCandidates.length} purchase
            {untidy.untaggedCandidates.length === 1 ? '' : 's'} with no “{tag}” tag,
            on a card you usually claim from
          </p>
          <p className="mb-2 text-xs text-ink-400">
            Either the tag was forgotten, or these really are personal. Only you
            can say which, so nothing is assumed. Accounts you have never claimed
            anything from are not asked about at all.
          </p>
          <TransactionTable rows={untidy.untaggedCandidates.slice(0, 10)} empty="" />
        </div>
      )}
    </div>
  )
}

function SavingsStep({ savings, accounts }: { savings: Savings; accounts: Account[] }) {
  const destination = accounts.find((a) => a.savingsDestination)
  const parts = presentIn(savings.total)

  if (!accounts.some((a) => a.funding)) {
    return (
      <p className="text-sm text-ink-500">
        Mark the account everything is paid from, on the Accounts tab, and this
        figure will appear.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white/70 px-4 py-4">
        {parts.length === 0 ? (
          <p className="text-lg font-semibold text-ink-400">—</p>
        ) : (
          parts.map(([currency, value]) => (
            <p key={currency} className="text-2xl font-semibold tabular-nums text-ink-900">
              {amountIn(Math.abs(value), currency)}
              <span className="ml-2 text-sm font-normal text-ink-500">
                {value >= 0
                  ? `free to move${destination ? ` to ${destination.nickname}` : ''}`
                  : 'short — this needs topping up'}
              </span>
            </p>
          ))
        )}
      </div>

      <ol className="space-y-1">
        {savings.parts.map((part, i) => (
          <li
            key={`${part.accountId}-${part.kind}-${i}`}
            className="flex items-baseline justify-between gap-4 text-xs"
          >
            <span className="text-ink-500">
              {describe(part.kind)} · {part.nickname}
              {part.asOf && <span className="text-ink-400"> as of {part.asOf}</span>}
              {part.missing && <span className="text-shell-500"> · no balance recorded</span>}
            </span>
            <span className="tabular-nums text-ink-900">
              {part.effect >= 0 ? '' : '− '}
              {amountIn(Math.abs(part.effect), part.currency)}
            </span>
          </li>
        ))}
      </ol>

      {savings.missing.length > 0 && (
        <p className="text-xs text-shell-500">
          {savings.missing.join(', ')} {savings.missing.length === 1 ? 'has' : 'have'} no
          balance recorded, so {savings.missing.length === 1 ? 'it counts' : 'they count'} as
          zero above. Record {savings.missing.length === 1 ? 'it' : 'them'} in step one for a
          figure you can act on.
        </p>
      )}

      <p className="text-xs text-ink-400">
        Tidewater never moves money. This is a figure to act on yourself.
      </p>
    </div>
  )
}

const describe = (kind: Savings['parts'][number]['kind']) =>
  kind === 'balance'
    ? 'Cash on hand'
    : kind === 'float'
      ? 'Float left behind'
      : kind === 'card'
        ? 'Owed on the card'
        : 'Charged, not yet posted'

function Pivot({
  rows,
  transactions,
  onSettle,
}: {
  rows: PivotRow[]
  transactions: EtmData['transactions']
  onSettle: (row: PivotRow, settled: boolean) => void
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        Nothing this month carries the reimbursable tag, so there is nothing to
        ask anyone for.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const key = `${row.bucket}-${row.currency}`
        return (
          <div key={key} className="rounded-2xl bg-white/70">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <button
                onClick={() => setOpen((o) => (o === key ? null : key))}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-ink-900">
                  {row.label}
                  {row.settled && <Tag>Asked for</Tag>}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {row.owedBy ? `Owed by ${row.owedBy}` : 'Nobody named yet'} ·{' '}
                  {row.count} transaction{row.count === 1 ? '' : 's'}
                </span>
              </button>
              <span className="text-right">
                <span className="block text-sm font-semibold tabular-nums text-ink-900">
                  {amountIn(row.amount, row.currency)}
                </span>
              </span>
              <button
                onClick={() => onSettle(row, !row.settled)}
                className={row.settled ? 'btn-quiet text-xs' : 'btn-ghost text-xs'}
              >
                {row.settled ? 'Not yet' : 'Mark asked for'}
              </button>
            </div>

            {open === key && (
              <div className="animate-fade border-t border-sand-200">
                <TransactionTable
                  rows={transactions
                    .filter((t) => row.transactionIds.includes(t.id))
                    .sort((a, z) => a.date.localeCompare(z.date))}
                  empty="Nothing here."
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Reconcile({
  reconciliation,
  tolerance,
  onToleranceChange,
  closed,
  closedAt,
  onClose,
  onReopen,
}: {
  reconciliation: Reconciliation
  tolerance: number
  onToleranceChange: (tolerance: number) => void
  closed: boolean
  closedAt?: string
  onClose: () => void
  onReopen: () => void
}) {
  const anchored = reconciliation.accounts.filter((a) => a.anchored)

  return (
    <div className="space-y-4">
      {anchored.length === 0 ? (
        <p className="text-sm text-ink-500">
          No account has both an opening and a closing balance for this month, so
          there is nothing to compare yet. A month opens where the last one
          closed, so recording this month’s balances in step one is enough from
          then on.
        </p>
      ) : (
        <div className="space-y-1">
          {anchored.map((entry) => (
            <div
              key={entry.accountId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {entry.nickname}
                  {!entry.withinTolerance && <Tag tone="warn">Off</Tag>}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {entry.count} row{entry.count === 1 ? '' : 's'} ·{' '}
                  {entry.opening?.date} → {entry.closing?.date}
                </span>
              </span>
              <span className="text-right text-xs">
                <span className="block text-ink-500">
                  balances {fmt(entry.observed ?? 0, entry.currency)} · rows{' '}
                  {fmt(entry.flow, entry.currency)}
                </span>
                <span
                  className={`block font-semibold tabular-nums ${
                    entry.withinTolerance ? 'text-tide-700' : 'text-shell-500'
                  }`}
                >
                  {Math.abs(entry.residual ?? 0) < 0.005
                    ? 'agrees exactly'
                    : `${fmt(entry.residual ?? 0, entry.currency)} unexplained`}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {reconciliation.notAnchored.length > 0 && (
        <p className="text-xs text-ink-400">
          Not anchored: {reconciliation.notAnchored.join(', ')}. These have
          activity but no pair of balances to measure against, so they are left
          out of the comparison rather than assumed to be fine.
        </p>
      )}

      {reconciliation.unexplained.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink-900">Largest rows to check</p>
          <p className="mb-2 text-xs text-ink-400">
            On the accounts that disagree, biggest first. A missing or duplicated
            one of these is the usual cause.
          </p>
          <TransactionTable rows={reconciliation.unexplained} empty="" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Close within
          <input
            className="field w-20"
            inputMode="decimal"
            value={String(tolerance)}
            onChange={(e) => {
              const value = Number(e.target.value.replace(/[^0-9.]/g, ''))
              if (Number.isFinite(value)) onToleranceChange(value)
            }}
          />
        </label>

        {closed ? (
          <>
            <span className="text-xs text-tide-700">
              Closed{closedAt ? ` on ${closedAt.slice(0, 10)}` : ''}.
            </span>
            <button onClick={onReopen} className="btn-ghost text-xs">
              Open it again
            </button>
          </>
        ) : (
          <button
            onClick={onClose}
            className="btn-primary text-xs"
            disabled={anchored.length === 0}
          >
            {reconciliation.balanced ? 'Close this month' : 'Close anyway'}
          </button>
        )}

        {!reconciliation.balanced && anchored.length > 0 && !closed && (
          <span className="text-xs text-ink-400">
            Closing with a difference is allowed — it is recorded, not hidden.
          </span>
        )}
      </div>
    </div>
  )
}

const fmt = (value: number, currency: Account['currency']) =>
  `${value < 0 ? '−' : ''}${amountIn(Math.abs(value), currency)}`

const Tag = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) => (
  <span
    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-normal uppercase tracking-wider ${
      tone === 'warn' ? 'bg-shell-300/40 text-shell-500' : 'bg-sand-200 text-ink-500'
    }`}
  >
    {children}
  </span>
)

function endOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}
