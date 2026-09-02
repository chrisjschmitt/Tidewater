import { useEffect, useState } from 'react'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import { forecastMix, isOutsideControlWindow, pinAddsToForecast, withCompareIgnores } from '../../lib/forecast/forecast'
import type {
  CurrentMonthView,
  ForecastMix,
  ForecastMixLine,
  KnownFuture,
  MonthPoint,
  OverlayBreakdown,
  PinRequest,
  RemainLine,
  SetAside,
  VarianceRow,
} from '../../lib/forecast/types'
import { PinComment, SavedPinComment } from './PinComment'
import {
  controlWindowBadge,
  controlWindowDetail,
  doubleCountCopy,
  remainReasonCopy,
  typeLabel,
} from './forecastCopy'

interface Props {
  point: MonthPoint
  current: CurrentMonthView
  setAside: SetAside
  usd?: { actual: number; calendar: number }
  placements: KnownFuture[]
  overlayBreakdown: OverlayBreakdown
  doubleCounts: Array<{ category: string; month: string }>
  onPlace: (row: PinRequest) => void
  onRemove: (id: string) => void
  onNotesChange: (id: string, notes: string) => void
  ignoredKeys: string[]
  onIgnore: (key: string, ignored: boolean) => void
}

export default function ForecastMonthCard({
  point,
  current,
  setAside,
  usd,
  placements,
  overlayBreakdown,
  doubleCounts,
  onPlace,
  onRemove,
  onNotesChange,
  ignoredKeys,
  onIgnore,
}: Props) {
  const isCurrent = point.kind === 'current'
  const actual = isCurrent ? current.actualToDate : point.kind === 'past' ? point.actual : 0
  const forecast = isCurrent ? current.forecastEom : point.calendar
  const plan = isCurrent ? current.plan : point.plan
  const compare = (isCurrent ? current.planVsForecast : point.planVsForecast) ?? []
  const ignoredSet = new Set(ignoredKeys)
  const displayed = withCompareIgnores(plan, forecast, compare, ignoredKeys)
  const difference = displayed.forecast - displayed.plan
  const outside = isOutsideControlWindow(displayed.forecast, displayed.plan)
  const variances = (isCurrent ? current.variances : point.variances).filter((row) => !ignoredSet.has(row.key))
  const remain = isCurrent ? current.remain : 0
  const lumps = point.byCategory.filter(
    (row) => (row.source === 'annual' || row.source === 'seasonal') && row.forecast > 0,
  )
  const lumpy = lumps.length > 0 && displayed.forecast > setAside.likely * 1.05
  const placeLabel = `Place in ${monthName(point.month)}`
  const mix = point.kind === 'future' ? forecastMix(point, placements) : null

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
            ? `Household spend so far, and what typically still lands by month-end. ${setAside.windowLabel}. Spend so far is beside that forecast first; then each category’s plan beside forecast.`
            : point.kind === 'past'
              ? 'Actual beside a forecast reconstructed from today’s engine — not the number you would have seen at the time. The table below is plan beside that forecast, largest gap first.'
              : `The typical-month plan beside what the ${setAside.windowLabel} places here. The table below is each category, largest gap first.`}
        </p>
        <p className="mt-2 max-w-prose text-sm text-ink-500">{controlWindowDetail(outside, displayed.forecast, displayed.plan)}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Plan" amount={displayed.plan} />
        <Figure label={isCurrent ? 'Forecast to month-end' : 'Forecast'} amount={displayed.forecast} />
        <Figure
          label="Difference"
          amount={difference}
          signed
          hint="forecast minus plan"
        />
      </div>
      {point.kind !== 'future' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Figure label={isCurrent ? 'Actual to today' : 'Actual'} amount={actual} />
          {isCurrent && <Figure label="Still typically lands" amount={remain} />}
        </div>
      )}

      {isCurrent && <WhatThisForecastIs rows={compare} remainLines={current.remainLines} />}

      <PlanVsForecastList
        rows={compare}
        toMonthEnd={isCurrent}
        month={point.month}
        ignoredKeys={ignoredKeys}
        onIgnore={onIgnore}
        onPlace={onPlace}
        doubleCounts={doubleCounts}
      />

      {isCurrent && current.remainLines.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">How that leftover adds up</p>
          <p className="mt-1 text-sm text-ink-500">
            Forecast to month-end is actual to today plus these lines. A seasonal
            month that has started still finishes toward when it is present.
            Irregular spend that has not started this month stays in Risk until it
            is pinned.
          </p>
          <ul className="mt-2 divide-y divide-sand-200/80">
            {current.remainLines.map((line) => (
              <li key={line.key} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink-900">{line.label}</span>
                  <span className="text-xs text-ink-400">{remainReasonCopy(line.reason)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums text-ink-700">
                    {amountIn(line.remain, 'CAD')}
                  </span>
                  <span className="text-[11px] tabular-nums text-ink-400">
                    {line.actual > 0
                      ? `${amountIn(line.actual, 'CAD')} spent of ${amountIn(line.typical, 'CAD')}`
                      : `${amountIn(line.typical, 'CAD')} typical`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mix && <ForecastMixList mix={mix} onRemove={onRemove} onNotesChange={onNotesChange} />}

      <RiskSection overlay={overlayBreakdown} placeLabel={placeLabel} onPlace={onPlace} />

      {usd && (usd.actual !== 0 || usd.calendar !== 0) && (
        <p className="mt-3 text-xs text-ink-400">
          USD sits alongside, never added in: {amountIn(usd.actual, 'USD')} so far, forecast{' '}
          {amountIn(usd.calendar, 'USD')}.
        </p>
      )}

      <p className="mt-4 text-sm text-ink-500">
        Recommended set-aside from this window: {amountIn(setAside.likely, 'CAD')} a month
        {setAside.overlay > 0
          ? `, of which ${amountIn(setAside.overlay, 'CAD')} is still in Risk.`
          : '.'}{' '}
        {lumpy && point.kind !== 'future'
          ? `This month carries ${lumps.map((row) => row.label).join(', ')}, so it sits above that typical month.`
          : isCurrent && displayed.forecast + 0.01 < displayed.plan
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
          underPlan={displayed.forecast + 0.01 < displayed.plan}
          onPlace={onPlace}
        />
      )}

      {placements.length > 0 && point.kind !== 'future' && (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Placed on this month</p>
          <ul className="mt-2 divide-y divide-sand-200/80">
            {placements.map((future) => (
              <li key={future.id} className="flex flex-col gap-1.5 py-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm text-ink-900">
                    {future.category}
                    <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-400">
                      {pinAddsToForecast(future)
                        ? future.recurrence === 'annual'
                          ? 'each year'
                          : 'once'
                        : 'on the plan'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="text-sm tabular-nums text-ink-700">{amountIn(future.amount, 'CAD')}</span>
                    <button onClick={() => onRemove(future.id)} className="btn-quiet text-xs">
                      Remove
                    </button>
                  </span>
                </span>
                <SavedPinComment notes={future.notes} onSave={(notes) => onNotesChange(future.id, notes)} />
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

function ForecastMixList({
  mix,
  onRemove,
  onNotesChange,
}: {
  mix: ForecastMix
  onRemove: (id: string) => void
  onNotesChange: (id: string, notes: string) => void
}) {
  const groups: Array<{ key: 'monthly' | 'lumpy' | 'pinned' | 'onPlan'; label: string; lines: ForecastMixLine[] }> = [
    { key: 'monthly', label: 'Every month', lines: mix.monthly },
    { key: 'lumpy', label: 'Usual this month', lines: mix.lumpy },
    { key: 'pinned', label: 'Pinned on this month', lines: mix.pinned },
    { key: 'onPlan', label: 'Added to this month’s plan', lines: mix.onPlan },
  ]
  if (groups.every((group) => group.lines.length === 0)) return null

  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">How this forecast is built</p>
      <p className="mt-1 text-sm text-ink-500">
        These lines add to the Forecast column, except amounts added to this
        month’s plan. Risk is not in this list.
      </p>
      {groups.map(
        (group) =>
          group.lines.length > 0 && (
            <div key={group.key} className="mt-3">
              <p className="text-[11px] uppercase tracking-wider text-ink-400">{group.label}</p>
              <ul className="mt-1 divide-y divide-sand-200/80">
                {group.lines.map((line) => (
                  <li
                    key={line.placementId ?? `${group.key}-${line.key}`}
                    className="flex flex-col gap-1.5 py-1.5"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-ink-900">
                        {line.label}
                        {line.recurrence && (
                          <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-400">
                            {line.recurrence === 'annual' ? 'each year' : 'once'}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        <span className="text-sm tabular-nums text-ink-700">{amountIn(line.amount, 'CAD')}</span>
                        {line.placementId && (
                          <button onClick={() => onRemove(line.placementId!)} className="btn-quiet text-xs">
                            Remove
                          </button>
                        )}
                      </span>
                    </span>
                    {line.placementId && (
                      <SavedPinComment
                        notes={line.notes ?? ''}
                        onSave={(notes) => onNotesChange(line.placementId!, notes)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  )
}

function actualToDateFor(row: VarianceRow, remainLines: RemainLine[]): number {
  const leftover = remainLines.find((line) => line.key === row.key)
  if (leftover) return leftover.actual
  return row.forecast
}

function WhatThisForecastIs({
  rows,
  remainLines,
}: {
  rows: VarianceRow[]
  remainLines: RemainLine[]
}) {
  const listed = [...rows]
    .map((row) => ({
      row,
      actual: actualToDateFor(row, remainLines),
    }))
    .filter((item) => item.actual !== 0 || item.row.forecast !== 0)
    .sort(
      (a, z) =>
        z.row.forecast - a.row.forecast || z.actual - a.actual || a.row.label.localeCompare(z.row.label),
    )
  const actualTotal = Math.round(listed.reduce((sum, item) => sum + item.actual, 0) * 100) / 100
  const forecastTotal = Math.round(listed.reduce((sum, item) => sum + item.row.forecast, 0) * 100) / 100

  return (
    <div id="forecast-this-month" className="mt-6 scroll-mt-28">
      <h3 className="text-sm font-semibold tracking-tight text-ink-900">What this forecast is</h3>
      <p className="mt-1 text-sm text-ink-500">
        Month-to-date spend beside forecast to month-end. Largest forecast first. Forecast is actual
        plus what typically still lands; Risk is not in this list.
      </p>
      {listed.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">No household spend or forecast this month yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="pb-2 pr-3 font-medium">Category</th>
                <th className="pb-2 pr-3 text-right font-medium">Actual to today</th>
                <th className="pb-2 text-right font-medium">Forecast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-200/80">
              {listed.map(({ row, actual }) => (
                <tr key={row.key}>
                  <td className="max-w-[10rem] truncate py-1.5 pr-3 text-ink-900 sm:max-w-none">{row.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink-500">{amountIn(actual, 'CAD')}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-700">
                    {amountIn(row.forecast, 'CAD')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-sand-200">
                <td className="pt-2 pr-3 text-sm font-medium text-ink-900">Total</td>
                <td className="pt-2 pr-3 text-right text-sm font-medium tabular-nums text-ink-900">
                  {amountIn(actualTotal, 'CAD')}
                </td>
                <td className="pt-2 text-right text-sm font-medium tabular-nums text-ink-900">
                  {amountIn(forecastTotal, 'CAD')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function signedCad(amount: number): string {
  return `${amount > 0 ? '+' : ''}${amountIn(amount, 'CAD')}`
}

function PlanVsForecastList({
  rows,
  toMonthEnd,
  month,
  ignoredKeys,
  onIgnore,
  onPlace,
  doubleCounts,
}: {
  rows: VarianceRow[]
  toMonthEnd: boolean
  month: string
  ignoredKeys: string[]
  onIgnore: (key: string, ignored: boolean) => void
  onPlace: (row: PinRequest) => void
  doubleCounts: Array<{ category: string; month: string }>
}) {
  const ignored = new Set(ignoredKeys)
  const active = rows.filter((row) => !ignored.has(row.key))
  const tucked = rows.filter((row) => ignored.has(row.key))
  const runningRows: Array<{ row: VarianceRow; running: number }> = []
  let running = 0
  for (const row of active) {
    running = Math.round((running + row.delta) * 100) / 100
    runningRows.push({ row, running })
  }
  const total = runningRows.at(-1)?.running ?? 0
  const planTotal = Math.round(active.reduce((sum, row) => sum + row.plan, 0) * 100) / 100
  const forecastTotal = Math.round(active.reduce((sum, row) => sum + row.forecast, 0) * 100) / 100
  const placeLabel = `Pin in ${monthName(month)}`

  return (
    <div id="forecast-compare" className="mt-6 scroll-mt-28">
      <h3 className="text-sm font-semibold tracking-tight text-ink-900">Plan vs forecast by category</h3>
      <p className="mt-1 text-sm text-ink-500">
        {toMonthEnd
          ? 'Typical-month plan (plus any pin on this month) beside forecast to month-end. Difference is forecast minus plan. Largest absolute gap first. The running total adds those signed differences as you go down.'
          : 'Typical-month plan (plus any pin on this month) beside the forecast this card places. Difference is forecast minus plan. Largest absolute gap first. The running total adds those signed differences as you go down.'}{' '}
        Ignore a line if you expect to hit Plan there anyway — that gap leaves
        Forecast; Plan does not change. Pin adds the amount to Plan; the trend
        is already in Forecast. Skipping a category for a month is a plan
        change, not an ignore.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">No category has a plan or a forecast this month.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
              <th className="pb-2 pr-2 font-medium">
                <span className="sr-only">Ignore</span>
              </th>
              <th className="pb-2 pr-3 font-medium">Category</th>
              <th className="pb-2 pr-3 text-right font-medium">Plan</th>
              <th className="pb-2 pr-3 text-right font-medium">Forecast</th>
              <th className="pb-2 pr-3 text-right font-medium">Difference</th>
              <th className="pb-2 pr-3 text-right font-medium">Running total</th>
              <th className="pb-2 text-right font-medium">
                <span className="sr-only">Pin</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-200/80">
            {runningRows.map(({ row, running: soFar }) => (
              <CompareRow
                key={row.key}
                row={row}
                running={soFar}
                ignored={false}
                month={month}
                placeLabel={placeLabel}
                warned={doubleCounts.some((warning) => warning.category === row.label)}
                onIgnore={onIgnore}
                onPlace={onPlace}
              />
            ))}
          </tbody>
          <tbody>
            <tr className="border-t border-sand-200">
              <td className="pt-2" />
              <td className="pt-2 pr-3 text-sm font-medium text-ink-900">
                Total{tucked.length > 0 ? ' of these lines' : ''}
              </td>
              <td className="pt-2 pr-3 text-right text-sm font-medium tabular-nums text-ink-900">
                {amountIn(planTotal, 'CAD')}
              </td>
              <td className="pt-2 pr-3 text-right text-sm font-medium tabular-nums text-ink-900">
                {amountIn(forecastTotal, 'CAD')}
              </td>
              <td className="pt-2 pr-3 text-right text-sm font-medium tabular-nums text-ink-900">
                {signedCad(total)}
              </td>
              <td className="pt-2 pr-3 text-right text-sm font-medium tabular-nums text-ink-900">
                {signedCad(total)}
              </td>
              <td className="pt-2" />
            </tr>
          </tbody>
          {tucked.length > 0 && (
            <tbody className="divide-y divide-sand-200/80">
              <tr>
                <td colSpan={7} className="border-t border-sand-300 pt-3 pb-1 text-[11px] uppercase tracking-wider text-ink-400">
                  Ignored
                </td>
              </tr>
              {tucked.map((row) => (
                <CompareRow
                  key={row.key}
                  row={row}
                  ignored
                  month={month}
                  placeLabel={placeLabel}
                  warned={doubleCounts.some((warning) => warning.category === row.label)}
                  onIgnore={onIgnore}
                  onPlace={onPlace}
                />
              ))}
            </tbody>
          )}
        </table>
        </div>
      )}
    </div>
  )
}

function pinAmountFor(row: VarianceRow): number {
  const gap = Math.abs(row.delta)
  if (gap > 0) return gap
  if (row.forecast > 0) return row.forecast
  return row.plan
}

function CompareRow({
  row,
  running,
  ignored,
  month,
  placeLabel,
  warned,
  onIgnore,
  onPlace,
}: {
  row: VarianceRow
  running?: number
  ignored: boolean
  month: string
  placeLabel: string
  warned: boolean
  onIgnore: (key: string, ignored: boolean) => void
  onPlace: (item: PinRequest) => void
}) {
  const pinDefault = pinAmountFor(row)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(pinDefault)
  const [notes, setNotes] = useState('')
  useEffect(() => {
    setAmount(pinDefault)
    setNotes('')
    setOpen(false)
  }, [row.key, pinDefault])

  const muted = ignored ? 'text-ink-400' : 'text-ink-900'

  return (
    <>
      <tr className={ignored ? 'bg-sand-50/60' : undefined}>
        <td className="py-1.5 pr-2 align-top">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-tide-600"
            checked={ignored}
            aria-label={`Ignore ${row.label} in this comparison`}
            onChange={(event) => onIgnore(row.key, event.target.checked)}
          />
        </td>
        <td className={`max-w-[10rem] truncate py-1.5 pr-3 sm:max-w-none ${muted}`}>{row.label}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums text-ink-500">{amountIn(row.plan, 'CAD')}</td>
        <td className={`py-1.5 pr-3 text-right tabular-nums ${ignored ? 'text-ink-400' : 'text-ink-700'}`}>
          {amountIn(row.forecast, 'CAD')}
        </td>
        <td className={`py-1.5 pr-3 text-right tabular-nums ${ignored ? 'text-ink-400' : 'text-ink-700'}`}>
          {signedCad(row.delta)}
        </td>
        <td className={`py-1.5 pr-3 text-right tabular-nums ${ignored ? 'text-ink-400' : 'text-ink-700'}`}>
          {running == null ? '—' : signedCad(running)}
        </td>
        <td className="py-1.5 text-right align-top">
          <button type="button" onClick={() => setOpen((value) => !value)} className="btn-quiet text-xs">
            {open ? 'Close' : 'Pin'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className={ignored ? 'bg-sand-50/60' : undefined}>
          <td />
          <td colSpan={6} className="pb-3 pr-3">
            {warned && <p className="mb-2 text-sm text-ink-500">{doubleCountCopy(row.label, monthName(month))}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="field w-24 py-1.5 text-sm tabular-nums"
                inputMode="decimal"
                aria-label={`Amount to pin for ${row.label}`}
                value={amount || ''}
                onChange={(event) => setAmount(Number(event.target.value.replace(/[^0-9.]/g, '')) || 0)}
              />
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={!(amount > 0)}
                onClick={() => {
                  onPlace({ category: row.label, amount, notes, addsTo: 'plan' })
                  setOpen(false)
                  setNotes('')
                }}
              >
                {placeLabel}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-400">Adds to Plan. Forecast already has this trend.</p>
            <div className="mt-2 max-w-md">
              <PinComment value={notes} onChange={setNotes} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function RiskSection({
  overlay,
  placeLabel,
  onPlace,
}: {
  overlay: OverlayBreakdown
  placeLabel: string
  onPlace: (row: PinRequest) => void
}) {
  const shareTotal = overlay.lines.reduce((sum, line) => sum + line.share, 0)

  return (
    <div id="forecast-risk" className="mt-6 scroll-mt-28">
      <h3 className="text-sm font-semibold tracking-tight text-ink-900">Risk</h3>
      <p className="mt-1 text-sm text-ink-500">
        Irregular spend that still has no month. It is not in the Forecast column. Pin a line onto
        this month to take it out of Risk.
      </p>
      <div className="mt-3 max-w-xs">
        <Figure label="Risk" amount={overlay.monthly} hint="unplaced, not in Forecast" />
      </div>
      {overlay.placedNextYear > 0 && (
        <p className="mt-3 text-sm text-ink-500">
          Pins in the next twelve months take {amountIn(overlay.placedNextYear, 'CAD')} off this
          remainder before it is spread.
        </p>
      )}
      {overlay.lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">Nothing is sitting in Risk right now.</p>
      ) : (
        <ul className="mt-3 divide-y divide-sand-200/80">
          {overlay.lines.map((line) => (
            <RiskItem key={line.key} line={line} placeLabel={placeLabel} onPlace={onPlace} />
          ))}
        </ul>
      )}
      {Math.abs(shareTotal - overlay.monthly) > 0.02 && overlay.placedNextYear === 0 && overlay.lines.length > 0 && (
        <p className="mt-2 text-xs text-ink-400">
          After leaving the largest irregulars aside, Risk on the card is {amountIn(overlay.monthly, 'CAD')}.
        </p>
      )}
    </div>
  )
}

function RiskItem({
  line,
  placeLabel,
  onPlace,
}: {
  line: OverlayBreakdown['lines'][number]
  placeLabel: string
  onPlace: (item: PinRequest) => void
}) {
  const pinDefault = line.lastAmount > 0 ? line.lastAmount : line.windowTotal
  const [amount, setAmount] = useState(pinDefault)
  const [notes, setNotes] = useState('')
  useEffect(() => {
    setAmount(pinDefault)
    setNotes('')
  }, [line.key, pinDefault])

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <span className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink-900">{line.label}</span>
          <span className="text-xs tabular-nums text-ink-400">
            {amountIn(line.share, 'CAD')} /mo in Risk
            {line.lowSample ? ` · ${typeLabel('irregular', true)}` : ''}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <input
            className="field w-24 py-1.5 text-sm tabular-nums"
            inputMode="decimal"
            aria-label={`Amount to pin for ${line.label}`}
            value={amount || ''}
            onChange={(event) => setAmount(Number(event.target.value.replace(/[^0-9.]/g, '')) || 0)}
          />
          <button
            onClick={() => onPlace({ category: line.label, amount, notes })}
            className="btn-ghost text-xs"
            disabled={!(amount > 0)}
          >
            {placeLabel}
          </button>
        </span>
      </span>
      <PinComment value={notes} onChange={setNotes} />
    </li>
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
  onPlace: (row: PinRequest) => void
}) {
  return (
    <div className="mt-5">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">What makes up the gap</p>
      <p className="mt-1 text-sm text-ink-500">
        {underPlan
          ? 'These lines sit below the plan — spare room, unless a cost still needs a month.'
          : 'Pin adds this gap to Plan. Forecast already has the trend.'}
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
  onPlace: (item: PinRequest) => void
}) {
  const [amount, setAmount] = useState(Math.abs(row.delta))
  const [notes, setNotes] = useState('')
  useEffect(() => {
    setAmount(Math.abs(row.delta))
    setNotes('')
  }, [row.key, row.delta])

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <span className="flex flex-wrap items-center justify-between gap-3">
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
            onClick={() =>
              onPlace({
                category: row.label,
                amount,
                notes,
                addsTo: row.delta > 0 ? 'plan' : 'both',
              })
            }
            className="btn-ghost text-xs"
            disabled={!(amount > 0)}
          >
            {placeLabel}
          </button>
        </span>
      </span>
      <PinComment value={notes} onChange={setNotes} />
    </li>
  )
}

function postedLabels(point: MonthPoint, keys: string[]): string {
  const names = keys.map((key) => point.byCategory.find((row) => row.key === key)?.label ?? key)
  return names.join(', ')
}

function Figure({
  label,
  amount,
  hint,
  signed,
}: {
  label: string
  amount: number
  hint?: string
  signed?: boolean
}) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
        {signed ? signedCad(amount) : amountIn(amount, 'CAD')}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
    </div>
  )
}
