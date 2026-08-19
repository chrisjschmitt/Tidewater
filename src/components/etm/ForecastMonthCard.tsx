import { useEffect, useState } from 'react'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { CurrentMonthView, KnownFuture, MonthPoint, SetAside, VarianceRow } from '../../lib/forecast/types'
import { controlWindowBadge, controlWindowDetail, doubleCountCopy } from './forecastCopy'

interface Props {
  point: MonthPoint
  current: CurrentMonthView
  setAside: SetAside
  usd?: { actual: number; calendar: number }
  placements: KnownFuture[]
  doubleCounts: Array<{ category: string; month: string }>
  onPlace: (row: { category: string; amount: number }) => void
  onRemove: (id: string) => void
}

export default function ForecastMonthCard({
  point,
  current,
  setAside,
  usd,
  placements,
  doubleCounts,
  onPlace,
  onRemove,
}: Props) {
  const isCurrent = point.kind === 'current'
  const actual = isCurrent ? current.actualToDate : point.kind === 'past' ? point.actual : 0
  const forecast = isCurrent ? current.forecastEom : point.calendar
  const plan = isCurrent ? current.plan : point.plan
  const overlay = isCurrent ? current.overlay : point.overlay
  const remain = isCurrent ? current.remain : 0
  const outside = isCurrent ? current.outsideControlWindow : point.outsideControlWindow
  const variances = isCurrent ? current.variances : point.variances
  const lumps = point.byCategory.filter(
    (row) => (row.source === 'annual' || row.source === 'seasonal') && row.forecast > 0,
  )
  const lumpy = lumps.length > 0 && forecast > setAside.likely * 1.05
  const placeLabel = `Place in ${monthName(point.month)}`

  return (
    <section className="card p-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">{monthName(point.month)}</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              outside ? 'bg-sand-200 text-ink-600' : 'bg-tide-50 text-tide-700'
            }`}
          >
            {controlWindowBadge(outside)}
          </span>
        </div>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          {isCurrent
            ? `Household spend so far, and what typically still lands by month-end. ${setAside.windowLabel}.`
            : point.kind === 'past'
              ? 'Actual beside a forecast reconstructed from today’s engine — not the number you would have seen at the time.'
              : `The typical-month plan beside what the ${setAside.windowLabel} places here.`}
        </p>
        <p className="mt-2 max-w-prose text-sm text-ink-500">{controlWindowDetail(outside, forecast, plan)}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Plan" amount={plan} />
        {point.kind !== 'future' && (
          <Figure label={isCurrent ? 'Actual to today' : 'Actual'} amount={actual} />
        )}
        <Figure label={isCurrent ? 'Forecast to month-end' : 'Forecast'} amount={forecast} />
        {isCurrent ? (
          <Figure label="Still typically lands" amount={remain} />
        ) : (
          <Figure
            label="Residual overlay"
            amount={overlay}
            hint="unplaced, not in the column"
          />
        )}
      </div>

      {usd && (usd.actual !== 0 || usd.calendar !== 0) && (
        <p className="mt-3 text-xs text-ink-400">
          USD sits alongside, never added in: {amountIn(usd.actual, 'USD')} so far, forecast{' '}
          {amountIn(usd.calendar, 'USD')}.
        </p>
      )}

      <p className="mt-4 text-sm text-ink-500">
        Recommended set-aside from this window: {amountIn(setAside.likely, 'CAD')} a month
        {setAside.overlay > 0
          ? `, of which ${amountIn(setAside.overlay, 'CAD')} is still unplaced irregular cost.`
          : '.'}{' '}
        {lumpy
          ? `This month carries ${lumps.map((row) => row.label).join(', ')}, so it sits above that typical month.`
          : isCurrent && forecast + 0.01 < plan
            ? 'There looks to be spare room against the plan.'
            : null}
      </p>

      {isCurrent && current.postedTypicalKeys.length > 0 && (
        <p className="mt-2 text-xs text-ink-400">
          Already posted this month, so not counted again in what is left:{' '}
          {postedLabels(point, current.postedTypicalKeys)}.
        </p>
      )}

      {outside && variances.length > 0 && (
        <VarianceList
          rows={variances}
          placeLabel={placeLabel}
          underPlan={forecast + 0.01 < plan}
          onPlace={onPlace}
        />
      )}

      {placements.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Placed on this month</p>
          <ul className="mt-2 divide-y divide-sand-200/80">
            {placements.map((future) => (
              <li key={future.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 text-sm text-ink-900">
                  {future.category}
                  <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-400">
                    {future.recurrence === 'annual' ? 'each year' : 'once'}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="text-sm tabular-nums text-ink-700">{amountIn(future.amount, 'CAD')}</span>
                  <button onClick={() => onRemove(future.id)} className="btn-quiet text-xs">
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doubleCounts.length > 0 && (
        <div className="mt-4 space-y-1">
          {doubleCounts.map((warning) => (
            <p key={`${warning.category}-${warning.month}`} className="text-sm text-ink-500">
              {doubleCountCopy(warning.category, monthName(warning.month))}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

function VarianceList({
  rows,
  placeLabel,
  underPlan,
  onPlace,
}: {
  rows: VarianceRow[]
  placeLabel: string
  underPlan: boolean
  onPlace: (row: { category: string; amount: number }) => void
}) {
  return (
    <div className="mt-5">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">What makes up the gap</p>
      <p className="mt-1 text-sm text-ink-500">
        {underPlan
          ? 'These lines sit below the plan — spare room, unless a cost still needs a month.'
          : 'Each line can be placed on this month. Once a cost has a date, it leaves the overlay.'}
      </p>
      <ul className="mt-3 divide-y divide-sand-200/80">
        {rows.map((row) => (
          <VarianceItem key={row.key} row={row} placeLabel={placeLabel} onPlace={onPlace} />
        ))}
      </ul>
    </div>
  )
}

function VarianceItem({
  row,
  placeLabel,
  onPlace,
}: {
  row: VarianceRow
  placeLabel: string
  onPlace: (item: { category: string; amount: number }) => void
}) {
  const [amount, setAmount] = useState(Math.abs(row.delta))
  useEffect(() => {
    setAmount(Math.abs(row.delta))
  }, [row.key, row.delta])

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink-900">{row.label}</span>
        <span className="text-xs tabular-nums text-ink-400">
          {row.delta > 0 ? '+' : ''}
          {amountIn(row.delta, 'CAD')} from the typical-month line
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <input
          className="field w-24 py-1.5 text-sm tabular-nums"
          inputMode="decimal"
          aria-label={`Amount to place for ${row.label}`}
          value={amount || ''}
          onChange={(event) => setAmount(Number(event.target.value.replace(/[^0-9.]/g, '')) || 0)}
        />
        <button
          onClick={() => onPlace({ category: row.label, amount })}
          className="btn-ghost text-xs"
          disabled={!(amount > 0)}
        >
          {placeLabel}
        </button>
      </span>
    </li>
  )
}

function postedLabels(point: MonthPoint, keys: string[]): string {
  const names = keys.map((key) => point.byCategory.find((row) => row.key === key)?.label ?? key)
  return names.join(', ')
}

function Figure({ label, amount, hint }: { label: string; amount: number; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{amountIn(amount, 'CAD')}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
    </div>
  )
}
