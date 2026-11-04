import { useEffect, useRef } from 'react'
import { monthName } from '../../lib/etm/period'
import type { MonthPoint } from '../../lib/forecast/types'
import { shortMonth } from './forecastCopy'

/**
 * Which month the page is showing, kept in the sticky bar so it can't be
 * forgotten while scrolling a month's details: its name, a step either way,
 * and — once the full timeline has scrolled away — a slim strip of every
 * month to jump to.
 */
export default function ForecastMonthStrip({
  calendar,
  selected,
  currentMonth,
  showStrip,
  onSelect,
}: {
  calendar: MonthPoint[]
  selected: string
  currentMonth: string
  /** The full timeline is out of view, so the strip stands in for it. */
  showStrip: boolean
  onSelect: (month: string) => void
}) {
  const months = calendar.map((point) => point.month)
  const index = months.indexOf(selected)
  const previous = index > 0 ? months[index - 1] : undefined
  const next = index >= 0 && index < months.length - 1 ? months[index + 1] : undefined
  const chosen = useRef<HTMLButtonElement>(null)

  // Keep the chosen month in view inside the strip.
  useEffect(() => {
    if (showStrip) chosen.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selected, showStrip])

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-quiet px-2 text-xs"
          disabled={!previous}
          onClick={() => previous && onSelect(previous)}
          aria-label={previous ? `Show ${monthName(previous)}` : undefined}
        >
          ‹
        </button>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            selected === currentMonth ? 'bg-tide-50 text-tide-700' : 'bg-shell-50 text-ink-900 ring-1 ring-shell-300'
          }`}
          aria-live="polite"
        >
          Showing {monthName(selected)}
          {selected !== currentMonth && <span className="font-normal text-ink-500"> · not this month</span>}
        </span>
        <button
          type="button"
          className="btn-quiet px-2 text-xs"
          disabled={!next}
          onClick={() => next && onSelect(next)}
          aria-label={next ? `Show ${monthName(next)}` : undefined}
        >
          ›
        </button>
        {selected !== currentMonth && (
          <button type="button" className="btn-ghost text-xs" onClick={() => onSelect(currentMonth)}>
            Back to {monthName(currentMonth)}
          </button>
        )}
      </div>
      {showStrip && (
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1" role="list" aria-label="Months">
          {calendar.map((point) => {
            const isSelected = point.month === selected
            const newYear = point.month.endsWith('-01')
            return (
              <button
                key={point.month}
                ref={isSelected ? chosen : undefined}
                type="button"
                role="listitem"
                onClick={() => onSelect(point.month)}
                aria-current={isSelected ? 'true' : undefined}
                title={monthName(point.month)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] tabular-nums ${
                  isSelected
                    ? 'bg-tide-600 font-medium text-white'
                    : point.kind === 'current'
                      ? 'bg-tide-50 text-tide-700'
                      : point.kind === 'past'
                        ? 'text-ink-400 hover:bg-sand-100'
                        : 'text-ink-700 hover:bg-sand-100'
                }`}
              >
                {shortMonth(point.month)}
                {newYear && <span className="ml-0.5 opacity-70">’{point.month.slice(2, 4)}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
