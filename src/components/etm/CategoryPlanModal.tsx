import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../Modal'
import TransactionTable from './TransactionTable'
import { NoteLine, WhyFields } from './ForecastMonthCard'
import { shortMonth } from './forecastCopy'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { Transaction } from '../../lib/etm/types'
import { planAmountAt, planKey } from '../../lib/forecast/planHistory'
import { everyTwoWeeksMonthly, paydaysIn, scheduleLabel, scheduleWeeks } from '../../lib/budget'
import type { EveryTwoWeeks } from '../../lib/types'
import { planChanges, type PlanChangeRequest, type PlanNoteDraft } from '../../lib/forecast/planNotes'
import type { ForecastConfig, MonthPoint } from '../../lib/forecast/types'
import { householdRowsIn } from '../../lib/forecast/universe'
import type { Budget } from '../../lib/types'

/**
 * One category, month by month: the plan for each of the timeline's months
 * beside what was spent (past) or is forecast (ahead). Tap a month to see it;
 * this month and later can be changed — this month only, or from it on —
 * with a note on why. Past months are the record and stay as they were.
 */
export default function CategoryPlanModal({
  category,
  initialMonth,
  currentMonth,
  calendar,
  budget,
  config,
  resolvedConfig,
  transactions,
  reimbursableParentTag,
  showTransactions = false,
  onPlanChange,
  onPlanForMonth,
  onChangeNote,
  onStandingNote,
  onEdit,
  onClose,
}: {
  category: { key: string; label: string }
  initialMonth: string
  currentMonth: string
  calendar: MonthPoint[]
  budget: Budget
  config: ForecastConfig
  resolvedConfig: ForecastConfig
  transactions: Transaction[]
  reimbursableParentTag: string
  /** Opened from Actual to today: the month's transactions start open. */
  showTransactions?: boolean
  onPlanChange?: (change: PlanChangeRequest) => void
  onPlanForMonth?: (change: PlanChangeRequest) => void
  onChangeNote: (month: string, draft: PlanNoteDraft) => void
  onStandingNote: (draft: PlanNoteDraft) => void
  onEdit?: (row: Transaction) => void
  onClose: () => void
}) {
  const { key, label } = category
  const [month, setMonth] = useState(initialMonth)
  // A line paid every few weeks is planned per payment.
  const schedule = budget.expenses.find((line) => planKey(line.name) === key && line.everyTwoWeeks)?.everyTwoWeeks
  const changes = planChanges(budget, config.planHistory, config.planNotes, key)
  const changeMonths = new Set(changes.map((c) => c.month))
  const notedMonths = new Set((config.planNotes?.[key]?.changes ?? []).map((c) => c.month))

  const columns = calendar.map((point) => {
    const row = point.planVsForecast.find((r) => r.key === key)
    const cat = point.byCategory.find((c) => c.key === key)
    const typical = planAmountAt(budget, config.planHistory, key, point.month)
    const plan = row?.plan ?? typical
    return {
      point,
      plan,
      typical,
      pinned: Math.round((plan - typical) * 100) / 100,
      spent: cat?.actual ?? 0,
      forecast: row?.forecast ?? cat?.forecast ?? 0,
    }
  })
  const peak = Math.max(1, ...columns.flatMap((c) => [c.plan, c.point.kind === 'future' ? c.forecast : c.spent]))
  const selected = columns.find((c) => c.point.month === month) ?? columns[columns.length - 1]!
  const isPast = selected.point.kind === 'past'
  const editable = !isPast && Boolean(onPlanChange)

  // ← → step through the months, unless a field is being typed in.
  const months = calendar.map((point) => point.month)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (isTyping(event.target)) return
      event.preventDefault()
      setMonth((current) => {
        const at = months.indexOf(current)
        const next = months[at + (event.key === 'ArrowLeft' ? -1 : 1)]
        return next ?? current
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [months.join()])

  const chosen = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    chosen.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [month])

  const story = [...changes].reverse().find((c) => c.month <= selected.point.month)
  const atMonth = changes.find((c) => c.month === selected.point.month)

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title={`${label} by month`}
      subtitle="Plan beside what was spent, and ahead what is forecast. Tap a month (or use ← →) to see it; this month and later can be changed."
    >
      <div className="space-y-4">
        {schedule && (
          <p className="rounded-xl bg-sand-100/70 px-3 py-2 text-xs text-ink-700">
            {scheduleLabel(schedule)} from {schedule.firstPayday} · {amountIn(schedule.perPayment, 'CAD')} a payment · about{' '}
            {amountIn(everyTwoWeeksMonthly(schedule.perPayment, scheduleWeeks(schedule)), 'CAD')} in an average month.{' '}
            <span className="text-ink-500">How often and the payment date are set on the line in your Budget.</span>
          </p>
        )}
        <div className="flex gap-1 overflow-x-auto pb-2" role="list" aria-label={`${label} plan by month`}>
          {columns.map((c) => {
            const isSelected = c.point.month === selected.point.month
            const other = c.point.kind === 'future' ? c.forecast : c.spent
            const newYear = c.point.month.endsWith('-01')
            return (
              <button
                key={c.point.month}
                ref={isSelected ? chosen : undefined}
                type="button"
                role="listitem"
                onClick={() => setMonth(c.point.month)}
                aria-current={isSelected ? 'true' : undefined}
                className={`flex w-[4.75rem] shrink-0 flex-col items-stretch rounded-xl px-1.5 py-2 text-left ${
                  isSelected ? 'bg-tide-50 ring-2 ring-tide-500' : c.point.kind === 'current' ? 'bg-sand-100' : 'hover:bg-sand-100'
                }`}
              >
                <span className="flex items-center justify-between text-[11px] text-ink-500">
                  <span>
                    {shortMonth(c.point.month)}
                    {newYear && <span className="opacity-70"> ’{c.point.month.slice(2, 4)}</span>}
                  </span>
                  <span className="text-tide-600" aria-hidden="true">
                    {notedMonths.has(c.point.month) ? '✎' : changeMonths.has(c.point.month) ? '•' : ''}
                  </span>
                </span>
                {/* Plan (light) beside spent or forecast (dark). */}
                <span className="mt-1 flex h-12 items-end gap-1" aria-hidden="true">
                  <span className="w-1/2 rounded-t bg-sand-300" style={{ height: `${(c.plan / peak) * 100}%` }} />
                  <span
                    className={`w-1/2 rounded-t ${c.point.kind === 'future' ? 'bg-tide-300' : 'bg-tide-600'}`}
                    style={{ height: `${(other / peak) * 100}%` }}
                  />
                </span>
                <span className="mt-1 text-[11px] font-medium tabular-nums text-ink-900">{whole(c.plan)}</span>
                <span className="text-[10px] tabular-nums text-ink-400">
                  {c.point.kind === 'future' ? 'fc ' : c.point.kind === 'current' ? 'so far ' : ''}
                  {whole(other)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="-mt-2 text-[11px] text-ink-400">
          Light bar: plan. Dark bar: spent (past and this month so far); pale: forecast. • a plan change starts · ✎ with a
          note.
        </p>

        <section className="rounded-2xl bg-white/70 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-900">
              {monthName(selected.point.month)}
              {selected.point.kind === 'current' && <span className="font-normal text-ink-500"> · this month</span>}
            </h3>
            <p className="text-sm tabular-nums text-ink-700">
              Plan {amountIn(selected.plan, 'CAD')}
              {selected.pinned !== 0 && (
                <span className="text-ink-400"> (incl. pinned {amountIn(selected.pinned, 'CAD')})</span>
              )}
              {' · '}
              {selected.point.kind === 'future'
                ? `Forecast ${amountIn(selected.forecast, 'CAD')}`
                : `${selected.point.kind === 'current' ? 'Spent so far' : 'Spent'} ${amountIn(selected.spent, 'CAD')}`}
            </p>
          </div>

          {story && (
            <p className="mt-1 text-xs text-ink-500">
              {story.month === selected.point.month ? 'Changed this month' : `Since ${monthName(story.month)}`}:{' '}
              {amountIn(story.from, 'CAD')} → {amountIn(story.to, 'CAD')}
              {story.note?.text && <span className="text-ink-700"> — {story.note.text}</span>}
            </p>
          )}

          {editable ? (
            <MonthEditor
              key={`edit|${key}|${selected.point.month}`}
              month={selected.point.month}
              typical={selected.typical}
              {...(schedule ? { schedule } : {})}
              onSave={({ monthAmount, average, perPayment }, scope, note) => {
                const base = { key, label, month: selected.point.month, ...(note ? { note } : {}) }
                if (monthAmount === selected.typical) {
                  if (note) onChangeNote(selected.point.month, note)
                  return
                }
                if (scope === 'month' && onPlanForMonth) onPlanForMonth({ ...base, amount: monthAmount })
                else onPlanChange!({ ...base, amount: average, ...(perPayment !== undefined ? { perPayment } : {}) })
              }}
            />
          ) : (
            isPast && <p className="mt-2 text-xs text-ink-400">Past months are the record of what was planned; they can’t be changed here.</p>
          )}

          {atMonth && (
            <div className="mt-3">
              <NoteLine
                heading={`Note on the ${monthName(atMonth.month)} change`}
                note={atMonth.note}
                empty="No note yet."
                month={currentMonth}
                onSave={(draft) => onChangeNote(atMonth.month, draft)}
              />
            </div>
          )}

          {selected.point.kind !== 'future' && (
            <MonthTransactions
              key={`rows|${key}|${selected.point.month}`}
              category={category}
              month={selected.point.month}
              transactions={transactions}
              config={resolvedConfig}
              reimbursableParentTag={reimbursableParentTag}
              startOpen={showTransactions && selected.point.month === initialMonth}
              {...(onEdit ? { onEdit } : {})}
            />
          )}
        </section>

        <NoteLine
          heading="About this category"
          note={config.planNotes?.[key]?.standing}
          empty="No standing note — e.g. “Seasonal: higher Jun–Sep”."
          month={currentMonth}
          onSave={onStandingNote}
        />

        {changes.length > 0 && (
          <details className="rounded-2xl bg-white/70 px-4 py-3 text-sm">
            <summary className="cursor-pointer text-xs text-ink-500">
              Every change to this plan ({changes.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {[...changes].reverse().map((item) => (
                <li key={item.month}>
                  <NoteLine
                    heading={`${monthName(item.month)}: ${amountIn(item.from, 'CAD')} → ${amountIn(item.to, 'CAD')}`}
                    note={item.note}
                    empty="No note yet."
                    month={currentMonth}
                    onSave={(draft) => onChangeNote(item.month, draft)}
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  )
}

/** Arrow keys belong to a field while one is being typed in. */
export const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

const whole = (amount: number): string => `$${Math.round(amount).toLocaleString()}`

function MonthEditor({
  month,
  typical,
  schedule,
  onSave,
}: {
  month: string
  typical: number
  /** The line is paid every few weeks: the figure typed is one payment. */
  schedule?: EveryTwoWeeks
  onSave: (
    amounts: { monthAmount: number; average: number; perPayment?: number },
    scope: 'month' | 'onward',
    note?: PlanNoteDraft,
  ) => void
}) {
  const payments = schedule ? paydaysIn(schedule, month) : 1
  const weeks = schedule ? scheduleWeeks(schedule) : 0
  // This month's payment: its planned amount over its payment dates.
  const startPayment = schedule
    ? payments > 0
      ? Math.round((typical / payments) * 100) / 100
      : schedule.perPayment
    : typical
  const [draft, setDraft] = useState(String(startPayment))
  const [scope, setScope] = useState<'month' | 'onward'>('onward')
  const [why, setWhy] = useState<PlanNoteDraft>({ text: '' })
  const [saved, setSaved] = useState(false)
  const value = Number.parseFloat(draft.replace(/[$,\s]/g, ''))
  const amount = Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined
  const name = monthName(month).split(' ')[0]
  return (
    <form
      className="mt-3 rounded-xl bg-sand-100/60 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (amount === undefined) return
        const amounts = schedule
          ? {
              monthAmount: Math.round(amount * payments * 100) / 100,
              average: everyTwoWeeksMonthly(amount, weeks),
              perPayment: amount,
            }
          : { monthAmount: amount, average: amount }
        onSave(amounts, scope, why.text.trim() || why.reviewBy ? why : undefined)
        setSaved(true)
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-500">
          {schedule ? 'Per payment' : 'Plan'}
          <input
            className="field mt-1 block w-28 py-1.5 text-right text-sm tabular-nums"
            inputMode="decimal"
            value={draft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.target.value)
              setSaved(false)
            }}
          />
        </label>
        <fieldset className="flex flex-wrap gap-3 text-xs text-ink-700">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={scope === 'onward'} onChange={() => setScope('onward')} />
            From {name} on
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={scope === 'month'} onChange={() => setScope('month')} />
            {name} only
          </label>
        </fieldset>
        <button type="submit" className="btn-primary text-xs" disabled={amount === undefined}>
          Save
        </button>
        {saved && <span className="text-xs text-tide-700">Saved</span>}
      </div>
      {schedule && amount !== undefined && (
        <p className="mt-2 text-xs text-ink-700">
          {amountIn(amount, 'CAD')} × {payments} payment{payments === 1 ? '' : 's'} in {name} ={' '}
          <span className="font-medium">{amountIn(Math.round(amount * payments * 100) / 100, 'CAD')}</span> · about{' '}
          {amountIn(everyTwoWeeksMonthly(amount, weeks), 'CAD')} in an average month
        </p>
      )}
      <WhyFields draft={why} onChange={setWhy} month={month} />
      <p className="mt-2 text-[11px] text-ink-400">
        {scope === 'onward'
          ? `${name} and every later month take this plan, until a later change; earlier months keep theirs.`
          : `Only ${name} changes; the months before and after keep their plan.`}{' '}
        Pinned costs are added on top.
      </p>
    </form>
  )
}

function MonthTransactions({
  category,
  month,
  transactions,
  config,
  reimbursableParentTag,
  startOpen,
  onEdit,
}: {
  category: { key: string; label: string }
  month: string
  transactions: Transaction[]
  config: ForecastConfig
  reimbursableParentTag: string
  startOpen: boolean
  onEdit?: (row: Transaction) => void
}) {
  const [open, setOpen] = useState(startOpen)
  const { rows, spendSoFar } = useMemo(() => {
    const chronological = householdRowsIn(transactions, config, category.key, month, reimbursableParentTag).sort(
      (a, z) => a.date.localeCompare(z.date) || a.id.localeCompare(z.id),
    )
    const running = new Map<string, number>()
    let sum = 0
    for (const row of chronological) {
      sum = Math.round((sum - row.amount) * 100) / 100
      running.set(row.id, sum)
    }
    return { rows: chronological.reverse(), spendSoFar: { running, total: sum } }
  }, [transactions, config, category.key, month, reimbursableParentTag])

  return (
    <div className="mt-3">
      <button type="button" className="btn-quiet text-xs" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide' : 'Show'} the {rows.length} transaction{rows.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-white">
          <TransactionTable
            rows={rows}
            empty="Nothing was spent here this month."
            spendSoFar={spendSoFar}
            {...(onEdit ? { onEdit } : {})}
          />
        </div>
      )}
    </div>
  )
}
