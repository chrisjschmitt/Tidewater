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
  type Reconciliation,
  type Savings,
} from '../../lib/etm/workflow'
import { cardOwedAtMonthEnd, monthEndSteps, pendingAtMonthEnd, reimbursementsByAccount } from '../../lib/etm/monthEnd'
import { bucketName, owedBy } from '../../lib/etm/config'
import type { StepState } from '../../lib/etm/routine'
import { StepList } from './WeeklyCheckIn'
import ReimbursementsByAccount from './ReimbursementsByAccount'
import SettleUpCard from './SettleUpCard'
import TdStatementsCard from './TdStatementsCard'
import BackupCard from './BackupCard'
import type { Safeguards } from './useSafeguards'
import { balanceAnchors, cardBalanceTooEarly, downloadDayOf, localToday } from '../../lib/etm/statementFolder'
import { withPlanAtClose } from '../../lib/etm/closedPlan'
import type { Account, ReconciliationRecord, Transaction } from '../../lib/etm/types'
import type { Budget } from '../../lib/types'

interface Props {
  data: EtmData
  budget: Budget
  month: string
  onMonthChange: (month: string) => void
  /** Opens the shared editor on a row (ledger ids may carry a #part). */
  onEdit?: (row: Transaction) => void
  safeguards: Safeguards
  onRestoreBackup?: (file: File) => void
  /** Whether this device's data is backed up since its last change. */
  backupState: StepState
  /** The travel goal's monthly contribution, to set the transfer beside. */
  travelTarget?: { name: string; monthly: number }
}

/**
 * Month end as a routine, the way it is done by hand: tidy, check and settle
 * the reimbursements, confirm the balances, close the month, work out the
 * travel transfer, back up. It computes and explains; it never moves money.
 */
export default function WorkflowPanel({
  data,
  budget,
  month,
  onMonthChange,
  onEdit,
  safeguards,
  onRestoreBackup,
  backupState,
  travelTarget,
}: Props) {
  const record = data.reconciliations.find((r) => r.month === month)
  const closed = record?.status === 'reconciled'

  const asOf = endOf(month)
  const pending = useMemo(() => pendingAtMonthEnd(data.config.pending, month), [data.config.pending, month])
  const cardOwed = useMemo(
    () => cardOwedAtMonthEnd(data.config.pending, month, data.transactions),
    [data.config.pending, month, data.transactions],
  )
  const savings = useMemo(
    () =>
      computeSavings(
        data.accounts,
        data.balances,
        asOf,
        (id) => pending.get(id),
        (id) => cardOwed.get(id),
      ),
    [data.accounts, data.balances, asOf, pending, cardOwed],
  )
  // Rows skipped on Tidy (fine as they are) stay off its lists.
  const skippedIds = useMemo(() => new Set(data.config.tidySkipped ?? []), [data.config.tidySkipped])
  const untidyAll = useMemo(
    () => findUntidy(data.transactions, data.accounts, month, data.config),
    [data.transactions, data.accounts, month, data.config],
  )
  const untidy = useMemo(() => {
    const keep = (rows: Transaction[]) => rows.filter((t) => !skippedIds.has(t.id.split('#')[0]!))
    return {
      ...untidyAll,
      uncategorized: keep(untidyAll.uncategorized),
      parentOnly: keep(untidyAll.parentOnly),
      untaggedCandidates: keep(untidyAll.untaggedCandidates),
    }
  }, [untidyAll, skippedIds])
  const skippedHere = [...untidyAll.uncategorized, ...untidyAll.parentOnly, ...untidyAll.untaggedCandidates]
    .map((t) => t.id.split('#')[0]!)
    .filter((id) => skippedIds.has(id))
  const skip = (row: Transaction) =>
    void data.saveSettings({ ...data.config, tidySkipped: [...(data.config.tidySkipped ?? []), row.id.split('#')[0]!] })
  const unskipMonth = () => {
    const back = new Set(skippedHere)
    const rest = (data.config.tidySkipped ?? []).filter((id) => !back.has(id))
    void data.saveSettings({ ...data.config, tidySkipped: rest.length > 0 ? rest : undefined })
  }
  const groups = useMemo(
    () =>
      reimbursementsByAccount(
        data.transactions,
        data.accounts,
        month,
        data.config.reimbursableTag,
        (bucket) => bucketName(data.config, bucket),
        (bucket) => owedBy(data.config, bucket),
      ),
    [data.transactions, data.accounts, month, data.config],
  )
  const reconciliation = useMemo(
    () => reconcile(data.transactions, data.accounts, data.balances, month, data.config.tolerance),
    [data.transactions, data.accounts, data.balances, month, data.config.tolerance],
  )
  const checked = data.config.reimburseChecked?.[month] ?? []
  const transfer = data.config.transfers?.[month]
  const anchors = balanceAnchors(data.accounts)
  const untidyCount = untidy.uncategorized.length + untidy.parentOnly.length + untidy.untaggedCandidates.length
  const steps = monthEndSteps({
    untidy: untidyCount,
    reimbursements: groups,
    checked,
    ...(data.config.reimbursedOn?.[month] ? { reimbursedOn: data.config.reimbursedOn[month] } : {}),
    balancesIn: anchors.length > 0 && anchors.every((a) => closingFor(data.balances, a.id, month)),
    balanced: reconciliation.balanced,
    closed,
    transferRecorded: Boolean(transfer),
    backup: backupState,
  })

  const save = (changes: Partial<ReconciliationRecord>) =>
    void data.recordMonth(
      withPlanAtClose(
        {
          month,
          status: 'open',
          settled: record?.settled ?? [],
          residual: reconciliation.residual,
          notes: record?.notes ?? '',
          plannedSpend: record?.plannedSpend,
          ...changes,
        },
        budget,
      ),
    )
  const setChecked = (key: string, on: boolean) => {
    const next = new Set(checked)
    if (on) next.add(key)
    else next.delete(key)
    void data.saveSettings({ ...data.config, reimburseChecked: { ...(data.config.reimburseChecked ?? {}), [month]: [...next] } })
  }
  const cadSavings = savings.total.CAD
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.nickname ?? 'Unknown account'

  return (
    <div className="space-y-3">
      <YearStrip year={month.slice(0, 4)} selected={month} data={data} onSelect={onMonthChange} />
      <div className="card p-5">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Month end · {monthName(month)}</h2>
        <p className="text-sm text-ink-500">
          {steps.needCount === 0
            ? 'Everything is done for this month.'
            : `${steps.needCount} ${steps.needCount === 1 ? 'step needs' : 'steps need'} you.`}
        </p>
      </div>
      <StepList
        key={month}
        steps={[
          {
            key: 'tidy',
            title: 'Tidy',
            hint: 'Anything uncategorized, or reimbursable without a bucket — the reimbursements are only as good as the tags.',
            state: steps.tidy,
            ...(untidyCount > 0 ? { detail: `${untidyCount} to fix` } : {}),
            body: (
              <div className="space-y-3">
                <Tidy untidy={untidy} tag={data.config.reimbursableTag} onSkip={skip} accountName={accountName} {...(onEdit ? { onEdit } : {})} />
                {skippedHere.length > 0 && (
                  <p className="text-xs text-ink-400">
                    {skippedHere.length} skipped as fine.{' '}
                    <button type="button" className="underline underline-offset-2" onClick={unskipMonth}>
                      Show them again
                    </button>
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'reimbursements',
            title: 'Reimbursements',
            hint: 'By the account that paid, then by bucket. Check each bucket is theirs to reimburse; fix any row with Edit.',
            state: steps.reimbursements,
            ...(groups.count > 0 ? { detail: `${checked.length} of ${groups.accounts.reduce((n, a) => n + a.buckets.length, 0)} checked` } : {}),
            body: (
              <ReimbursementsByAccount
                month={month}
                groups={groups}
                checked={checked}
                onCheck={setChecked}
                transactions={data.transactions}
                accounts={data.accounts}
                config={data.config}
                {...(onEdit ? { onEdit } : {})}
              />
            ),
          },
          {
            key: 'settle',
            title: 'Mark reimbursed',
            hint: 'What each paying account is owed back; once the transfers are made, record the day.',
            state: steps.settle,
            body: (
              <SettleUpCard
                accounts={data.accounts}
                transactions={data.transactions}
                month={month}
                config={data.config}
                onConfigChange={(config) => void data.saveSettings(config)}
              />
            ),
          },
          {
            key: 'balances',
            title: 'Closing balances',
            hint: 'Read the TD statements for the month (or record a balance by hand), then see that the transactions explain them.',
            state: steps.balances,
            body: (
              <div className="space-y-4">
                <TdStatementsCard data={data} fixedMonth={month} />
                <Balances data={data} month={month} />
                <Reconcile
                  reconciliation={reconciliation}
                  tolerance={data.config.tolerance}
                  onToleranceChange={(tolerance) => void data.saveSettings({ ...data.config, tolerance })}
                  accountName={accountName}
                />
              </div>
            ),
          },
          {
            key: 'close',
            title: 'Close the month',
            hint: 'When the month was closed (a weekend close moves later rows into next month), then close it.',
            state: steps.close,
            body: (
              <div className="space-y-4">
                <ClosedOn data={data} month={month} />
                <CloseControls
                  closed={closed}
                  {...(record?.closedAt ? { closedAt: record.closedAt } : {})}
                  balanced={reconciliation.balanced}
                  anchored={reconciliation.accounts.some((a) => a.anchored)}
                  onClose={() =>
                    save({ status: 'reconciled', closedAt: new Date().toISOString(), savings: savings.total, residual: reconciliation.residual })
                  }
                  onReopen={() => void data.reopenMonth(month)}
                />
              </div>
            ),
          },
          {
            key: 'transfer',
            title: 'Travel transfer',
            hint: 'Expense account balance − float − what is owed on the Visa (current balance + pending) = what can go to travel savings.',
            state: steps.transfer,
            ...(transfer ? { detail: amountIn(transfer.amount, 'CAD') } : {}),
            body: (
              <div className="space-y-4">
                <SavingsStep savings={savings} accounts={data.accounts} />
                {travelTarget && travelTarget.monthly > 0 && cadSavings !== 0 && (
                  <p className="text-sm text-ink-600">
                    {travelTarget.name} asks for {amountIn(travelTarget.monthly, 'CAD')} a month —{' '}
                    {cadSavings >= travelTarget.monthly
                      ? `this covers it with ${amountIn(cadSavings - travelTarget.monthly, 'CAD')} to spare.`
                      : `${amountIn(travelTarget.monthly - cadSavings, 'CAD')} short.`}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {transfer ? (
                    <>
                      <span className="text-sm text-tide-700">
                        Recorded: {amountIn(transfer.amount, 'CAD')} to travel savings on {transfer.recordedAt.slice(0, 10)}.
                      </span>
                      <button
                        type="button"
                        className="btn-quiet text-xs"
                        onClick={() => {
                          const next = { ...(data.config.transfers ?? {}) }
                          delete next[month]
                          void data.saveSettings({ ...data.config, transfers: Object.keys(next).length > 0 ? next : undefined })
                        }}
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary text-xs disabled:opacity-50"
                      disabled={!cadSavings || cadSavings <= 0}
                      onClick={() =>
                        void data.saveSettings({
                          ...data.config,
                          transfers: { ...(data.config.transfers ?? {}), [month]: { amount: cadSavings, recordedAt: new Date().toISOString() } },
                        })
                      }
                    >
                      I transferred {amountIn(Math.max(cadSavings ?? 0, 0), 'CAD')}
                    </button>
                  )}
                </div>
              </div>
            ),
          },
          {
            key: 'backup',
            title: 'Back up',
            hint: 'Save the closed month, so the iPad can restore it.',
            state: steps.backup,
            body: <BackupCard safeguards={safeguards} {...(onRestoreBackup ? { onRestore: onRestoreBackup } : {})} />,
          },
        ]}
      />
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

function Balances({ data, month }: { data: EtmData; month: string }) {
  const [editing, setEditing] = useState<Account | null>(null)
  const anchors = balanceAnchors(data.accounts)

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
      <p className="px-1 text-xs text-ink-500">Recorded by hand — or filled in by reading the statements above. A balance typed here stays the override.</p>
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
                {closing && <TooEarlyNote account={account} snapshot={closing} month={month} />}
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

function ClosedOn({ data, month }: { data: EtmData; month: string }) {
  const cutoff = data.config.monthCutoffs?.[month] ?? ''
  const lastDay = endOf(month)
  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-white/70 px-4 py-3.5">
        <p className="text-sm font-medium text-ink-900">When this month was closed</p>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          If the month was closed before its last day (a weekend), transactions dated after the close count from the
          first of next month. The bank's dates are not changed.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-700">Closed on</span>
          <input
            type="date"
            className="field py-1.5"
            min={`${month}-01`}
            max={lastDay}
            value={cutoff || lastDay}
            onChange={(e) => {
              const next = { ...(data.config.monthCutoffs ?? {}) }
              if (!e.target.value || e.target.value >= lastDay) delete next[month]
              else next[month] = e.target.value
              void data.saveSettings({ ...data.config, monthCutoffs: Object.keys(next).length > 0 ? next : undefined })
            }}
          />
          {cutoff && (
            <span className="text-xs text-ink-500">
              Anything dated after {cutoff} counts in {monthName(nextMonthOf(month))}.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function CloseControls({
  closed,
  closedAt,
  balanced,
  anchored,
  onClose,
  onReopen,
}: {
  closed: boolean
  closedAt?: string
  balanced: boolean
  anchored: boolean
  onClose: () => void
  onReopen: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {closed ? (
        <>
          <span className="text-sm text-tide-700">Closed{closedAt ? ` on ${closedAt.slice(0, 10)}` : ''}.</span>
          <button onClick={onReopen} className="btn-ghost text-xs">
            Open it again
          </button>
        </>
      ) : (
        <>
          <button onClick={onClose} className="btn-primary text-xs" disabled={!anchored}>
            {balanced ? 'Close this month' : 'Close anyway'}
          </button>
          {!balanced && anchored && (
            <span className="text-xs text-ink-400">Closing with a difference is allowed — it is recorded, not hidden.</span>
          )}
          {!anchored && <span className="text-xs text-ink-400">Record the closing balances first.</span>}
        </>
      )}
    </div>
  )
}

function Tidy({
  untidy,
  tag,
  onEdit,
  onSkip,
  accountName,
}: {
  untidy: ReturnType<typeof findUntidy>
  tag: string
  onEdit?: (row: Transaction) => void
  onSkip?: (row: Transaction) => void
  accountName: (accountId: string) => string
}) {
  const nothing =
    untidy.uncategorized.length === 0 &&
    untidy.untaggedCandidates.length === 0 &&
    untidy.parentOnly.length === 0

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
            Edit each to give it a category, or Skip one that is fine as it is.
          </p>
          <TransactionTable rows={untidy.uncategorized.slice(0, 25)} empty="" editMonarch accountName={accountName} {...(onEdit ? { onEdit } : {})} {...(onSkip ? { onSkip } : {})} />
        </div>
      )}

      {untidy.parentOnly.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink-900">
            {untidy.parentOnly.length}{' '}
            {untidy.parentOnly.length === 1 ? 'row still uses' : 'rows still use'} only the
            generic “{tag}” tag
          </p>
          <p className="mb-2 text-xs text-ink-400">
            Edit each to tag it “{tag}: …” for the account or person who
            reimburses it — the generic tag alone puts it on no bucket.
          </p>
          <TransactionTable rows={untidy.parentOnly.slice(0, 25)} empty="" editMonarch accountName={accountName} {...(onEdit ? { onEdit } : {})} {...(onSkip ? { onSkip } : {})} />
        </div>
      )}

      {untidy.untaggedCandidates.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink-900">
            {untidy.untaggedCandidates.length} purchase
            {untidy.untaggedCandidates.length === 1 ? '' : 's'} with no “{tag}: …” tag,
            on a card you usually claim from
          </p>
          <p className="mb-2 text-xs text-ink-400">
            Either the tag was forgotten, or these really are personal. Only you
            can say which: Edit to tag it, or Skip a personal one. Accounts you have never claimed
            anything from are not asked about at all.
          </p>
          <TransactionTable rows={untidy.untaggedCandidates.slice(0, 25)} empty="" editMonarch accountName={accountName} {...(onEdit ? { onEdit } : {})} {...(onSkip ? { onSkip } : {})} />
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
              {part.source === 'easyweb' ? (
                <span className="text-ink-400">
                  {' '}
                  from EasyWeb’s balance on {part.asOf}, less charges posted after the month (counts payments not yet in the export)
                </span>
              ) : (
                part.asOf && <span className="text-ink-400"> as of {part.asOf}</span>
              )}
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
          zero above. Record {savings.missing.length === 1 ? 'it' : 'them'} under Closing balances for a
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

function Reconcile({
  reconciliation,
  tolerance,
  onToleranceChange,
  accountName,
}: {
  reconciliation: Reconciliation
  tolerance: number
  onToleranceChange: (tolerance: number) => void
  accountName: (accountId: string) => string
}) {
  const anchored = reconciliation.accounts.filter((a) => a.anchored)

  return (
    <div className="space-y-4">
      {anchored.length === 0 ? (
        <p className="text-sm text-ink-500">
          No account has both an opening and a closing balance for this month, so
          there is nothing to compare yet. A month opens where the last one
          closed, so recording this month’s balances above is enough from
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
                {!entry.withinTolerance && entry.closing && (
                  <TooEarlyNote account={entry} snapshot={entry.closing} month={reconciliation.month} />
                )}
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
          <TransactionTable rows={reconciliation.unexplained} empty="" accountName={accountName} />
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

function nextMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`
}

/**
 * A card balance read from a download taken at, or just after, the month's
 * end — TD may not have posted the last charges yet, so the rows run on past
 * the balance and the reconcile is off by them.
 */
function TooEarlyNote({
  account,
  snapshot,
  month,
}: {
  account: Pick<Account, 'kind'>
  snapshot: { source: 'manual' | 'statement'; fileName?: string }
  month: string
}) {
  const early = cardBalanceTooEarly(account, downloadDayOf(snapshot), month, localToday())
  if (!early) return null
  return (
    <span className="mt-0.5 block text-[11px] text-shell-500">
      Read from the {early.downloaded} download — TD can take a few days to post a card’s last charges, so this
      balance may be missing some of {monthName(month).split(' ')[0]}’s. Read {monthName(month).split(' ')[0]} again
      from a download on or after {early.readAgainFrom} (Read statement folder above) and record the card’s balance.
    </span>
  )
}
