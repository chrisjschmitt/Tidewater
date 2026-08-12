import { useMemo, useState } from 'react'
import CategoryTransactions from './CategoryTransactions'
import Modal from '../Modal'
import { moneyPrecise } from '../../lib/format'
import {
  aggregate,
  compareToBudget,
  isEmpty,
  presentIn,
  type GroupComparison,
  type Money,
  type PeriodActuals,
} from '../../lib/etm/aggregate'
import { amountIn } from '../../lib/etm/format'
import { periodLabel, type Period } from '../../lib/etm/period'
import type { Account, Transaction } from '../../lib/etm/types'
import type { Budget } from '../../lib/types'

interface Props {
  budget: Budget | null
  accounts: Account[]
  transactions: Transaction[]
  period: Period
  reimbursableTag: string
}

export default function BudgetPanel({
  budget,
  accounts,
  transactions,
  period,
  reimbursableTag,
}: Props) {
  const [openGroup, setOpenGroup] = useState<GroupComparison | null>(null)

  const excluded = useMemo(
    () => new Set(accounts.filter((a) => a.excludedFromBudget).map((a) => a.id)),
    [accounts],
  )
  const actuals = useMemo(
    () => aggregate(transactions, period, { excludeAccountIds: excluded, reimbursableTag }),
    [transactions, period, excluded, reimbursableTag],
  )
  const comparison = useMemo(
    () => (budget ? compareToBudget(budget, actuals) : null),
    [budget, actuals],
  )

  const excludedNames = accounts.filter((a) => a.excludedFromBudget).map((a) => a.nickname)

  if (!comparison || !budget) {
    return (
      <section className="card p-6">
        <p className="text-sm text-ink-500">
          There is no budget to compare against yet. Build one on the dashboard and it will appear
          here beside what you actually spent.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-5">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            Your plan and what happened
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            {periodLabel(period)}
            {comparison.months > 1 &&
              ` · your monthly plan counted ${comparison.months} times, once for each month in view`}
            . Nothing here is a verdict — it is your own numbers, side by side.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label="Planned" value={moneyPrecise(comparison.plannedTotal)} />
          <Figure label="Actually spent" money={comparison.actualTotal} />
          <Difference planned={comparison.plannedTotal} actual={comparison.actualTotal} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Figure label="Money in" money={actuals.income} />
          <Figure label="Money out" money={actuals.spend} />
        </div>

        <TieOut actuals={actuals} />

        {actuals.internal > 0 && (
          <p className="mt-4 text-xs text-ink-400">
            {actuals.internal.toLocaleString()} transfer{actuals.internal === 1 ? '' : 's'} and card
            payment{actuals.internal === 1 ? '' : 's'} in this period are left out of these totals.
          </p>
        )}
        {excludedNames.length > 0 && (
          <p className="mt-1 text-xs text-ink-400">
            {excludedNames.join(', ')} {excludedNames.length === 1 ? 'is' : 'are'} kept out of the
            family budget, so {excludedNames.length === 1 ? 'its' : 'their'} spending is not here.
          </p>
        )}
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">By group</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          Open any group to see its categories, and any category to see what made it up.
        </p>

        <div className="mt-4 space-y-1">
          {comparison.groups.map((group) => (
            <GroupRow key={group.group.id} group={group} onOpen={() => setOpenGroup(group)} />
          ))}
          {comparison.groups.length === 0 && (
            <p className="rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-ink-500">
              Nothing in this period yet.
            </p>
          )}
        </div>
      </section>

      {openGroup && (
        <GroupDrill
          group={openGroup}
          period={period}
          transactions={transactions}
          excluded={excluded}
          reimbursableTag={reimbursableTag}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  )
}

function GroupRow({ group, onOpen }: { group: GroupComparison; onOpen: () => void }) {
  const max = Math.max(group.planned, group.actual.CAD, 1)
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition hover:bg-sand-100/70"
    >
      <span className="w-40 shrink-0 truncate">
        <span className="block truncate text-sm font-medium text-ink-900">{group.group.name}</span>
        <span className="block truncate text-[11px] text-ink-400">
          {group.categories.length} categor{group.categories.length === 1 ? 'y' : 'ies'}
        </span>
      </span>

      <span className="flex-1 space-y-1">
        <span className="relative block h-2.5 overflow-hidden rounded-full bg-sand-200/70">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-sand-300"
            style={{ width: `${(group.planned / max) * 100}%` }}
          />
        </span>
        <span className="relative block h-2.5 overflow-hidden rounded-full bg-sand-200/70">
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.max(0, (group.actual.CAD / max) * 100)}%`,
              background: group.group.color,
            }}
          />
        </span>
      </span>

      <span className="w-36 shrink-0 text-right">
        <span className="block text-[11px] text-ink-400">
          planned {moneyPrecise(group.planned)}
        </span>
        <span className="block text-sm font-semibold tabular-nums text-ink-900">
          {moneyPrecise(group.actual.CAD)}
        </span>
        {group.actual.USD !== 0 && (
          <span className="block text-[11px] tabular-nums text-tide-700">
            + {amountIn(group.actual.USD, 'USD')}
          </span>
        )}
      </span>

      <span className="w-5 text-ink-300 opacity-0 transition group-hover:opacity-100">›</span>
    </button>
  )
}

function GroupDrill({
  group,
  period,
  transactions,
  excluded,
  reimbursableTag,
  onClose,
}: {
  group: GroupComparison
  period: Period
  transactions: Transaction[]
  excluded: Set<string>
  reimbursableTag: string
  onClose: () => void
}) {
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={group.group.name}
      subtitle={`${periodLabel(period)} · planned ${moneyPrecise(group.planned)}, spent ${moneyPrecise(group.actual.CAD)}`}
    >
      <div className="space-y-1">
        {group.categories.map((category) => (
          <div key={category.name} className="rounded-2xl bg-white/70">
            <button
              onClick={() =>
                setOpenCategory((c) => (c === category.name ? null : category.name))
              }
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {category.name}
                  {category.status === 'unplanned' && <Note>not in your plan</Note>}
                  {category.status === 'planned-only' && <Note>nothing spent</Note>}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {category.count} transaction{category.count === 1 ? '' : 's'}
                  {category.planned > 0 && ` · planned ${moneyPrecise(category.planned)}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-ink-900">
                  {moneyPrecise(category.actual.CAD)}
                </span>
                {category.actual.USD !== 0 && (
                  <span className="block text-[11px] tabular-nums text-tide-700">
                    + {amountIn(category.actual.USD, 'USD')}
                  </span>
                )}
                <DifferenceText planned={category.planned} actual={category.actual} />
              </span>
            </button>

            {openCategory === category.name && (
              <div className="animate-fade border-t border-sand-200">
                <CategoryTransactions
                  category={category.name}
                  period={period}
                  transactions={transactions}
                  excluded={excluded}
                  reimbursableTag={reimbursableTag}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

/**
 * The one place the two halves are added back together, so the figures above
 * can be trusted to leave nothing out: everything that left an account is
 * either budget spending or an advance that comes back.
 */
function TieOut({ actuals }: { actuals: PeriodActuals }) {
  if (isEmpty(actuals.reimbursable.spend)) return null
  const show = (money: Money) =>
    presentIn(money)
      .map(([currency, value]) => amountIn(Math.abs(value), currency))
      .join(' · ') || '—'

  return (
    <p className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-xs text-ink-500">
      <span className="font-semibold text-ink-900">
        {show(actuals.totalOut)} left your accounts
      </span>{' '}
      in this period — {show(actuals.spend)} of budget spending plus{' '}
      {show(actuals.reimbursable.spend)} of reimbursable spending across{' '}
      {actuals.reimbursable.count} transaction
      {actuals.reimbursable.count === 1 ? '' : 's'}, which is held out of
      everything above because it comes back.
    </p>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <span className="ml-2 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wider text-ink-500">
    {children}
  </span>
)

function Figure({ label, value, money }: { label: string; value?: string; money?: Money }) {
  const parts = money ? presentIn(money) : []
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      {value !== undefined && (
        <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</p>
      )}
      {money &&
        (parts.length === 0 ? (
          <p className="mt-1 text-lg font-semibold text-ink-400">—</p>
        ) : (
          parts.map(([currency, amount]) => (
            <p key={currency} className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
              {amountIn(Math.abs(amount), currency)}
            </p>
          ))
        ))}
    </div>
  )
}

function Difference({ planned, actual }: { planned: number; actual: Money }) {
  const gap = planned - actual.CAD
  const none = planned === 0 && isEmpty(actual)
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">
        {gap >= 0 ? 'Left of the plan' : 'Beyond the plan'}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          none ? 'text-ink-400' : gap >= 0 ? 'text-tide-700' : 'text-shell-500'
        }`}
      >
        {none ? '—' : moneyPrecise(Math.abs(gap))}
      </p>
    </div>
  )
}

function DifferenceText({ planned, actual }: { planned: number; actual: Money }) {
  if (planned === 0) return null
  const gap = planned - actual.CAD
  return (
    <span className={`block text-[11px] tabular-nums ${gap >= 0 ? 'text-tide-700' : 'text-shell-500'}`}>
      {gap >= 0 ? 'under by ' : 'over by '}
      {moneyPrecise(Math.abs(gap))}
    </span>
  )
}
