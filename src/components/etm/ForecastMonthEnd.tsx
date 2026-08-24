import { useEffect, useState } from 'react'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { CategoryMiss, MonthEndVariance } from '../../lib/forecast/snapshot'
import {
  controlWindowBadge,
  monthEndInsideCopy,
  monthEndOutsideCopy,
  monthEndReconstructedCopy,
  monthEndStoredCopy,
} from './forecastCopy'

interface Props {
  variance: MonthEndVariance
  placeMonth: string
  onPlace: (row: { category: string; amount: number }) => void
}

export default function ForecastMonthEnd({ variance, placeMonth, onPlace }: Props) {
  const placeLabel = `Place in ${monthName(placeMonth)}`
  const outside = variance.outsideControlWindow

  return (
    <section className="card p-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            {monthName(variance.month)}
          </h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              outside ? 'bg-sand-200 text-ink-600' : 'bg-tide-50 text-tide-700'
            }`}
          >
            {controlWindowBadge(outside)}
          </span>
          <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            {variance.source === 'stored' ? 'Stored snapshot' : 'Reconstructed'}
          </span>
        </div>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          {variance.source === 'stored'
            ? monthEndStoredCopy(monthName(variance.month))
            : monthEndReconstructedCopy(monthName(variance.month))}
        </p>
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          {outside ? monthEndOutsideCopy() : monthEndInsideCopy()}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Figure label="Forecast at the time" amount={variance.forecast} />
        <Figure label="Household actual" amount={variance.actual} />
      </div>

      {outside && variance.higher.length > 0 && (
        <MissList
          title="Higher than forecast"
          rows={variance.higher}
          placeLabel={placeLabel}
          onPlace={onPlace}
        />
      )}

      {outside && variance.lower.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Lower than forecast</p>
          <p className="mt-1 text-sm text-ink-500">Spare room on these lines, not a miss to pin.</p>
          <ul className="mt-3 divide-y divide-sand-200/80">
            {variance.lower.map((row) => (
              <li key={row.key} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-ink-900">{row.label}</span>
                <span className="text-sm tabular-nums text-ink-700">{amountIn(row.delta, 'CAD')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function MissList({
  title,
  rows,
  placeLabel,
  onPlace,
}: {
  title: string
  rows: CategoryMiss[]
  placeLabel: string
  onPlace: (row: { category: string; amount: number }) => void
}) {
  return (
    <div className="mt-5">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{title}</p>
      <ul className="mt-3 divide-y divide-sand-200/80">
        {rows.map((row) => (
          <MissItem key={row.key} row={row} placeLabel={placeLabel} onPlace={onPlace} />
        ))}
      </ul>
    </div>
  )
}

function MissItem({
  row,
  placeLabel,
  onPlace,
}: {
  row: CategoryMiss
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
          {amountIn(row.actual, 'CAD')} against {amountIn(row.forecast, 'CAD')}
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

function Figure({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{amountIn(amount, 'CAD')}</p>
    </div>
  )
}
