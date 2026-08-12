import { useState } from 'react'
import {
  monthName,
  monthPeriod,
  rangePeriod,
  today,
  ytdPeriod,
  type Period,
} from '../../lib/etm/period'

interface Props {
  period: Period
  onChange: (period: Period) => void
  /** Months that hold data, newest first, so the list is never empty-handed. */
  months: string[]
}

export default function PeriodSelector({ period, onChange, months }: Props) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(period.start)
  const [end, setEnd] = useState(period.end)

  const currentMonth = period.kind === 'month' ? period.start.slice(0, 7) : ''
  const choices = months.length > 0 ? months : [today().slice(0, 7)]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="rounded-full border border-sand-300 bg-white/80 px-3.5 py-1.5 text-xs text-ink-700 focus:border-tide-500 focus:outline-none"
        value={currentMonth}
        onChange={(e) => {
          setOpen(false)
          onChange(monthPeriod(e.target.value))
        }}
      >
        {currentMonth === '' && <option value="">A month…</option>}
        {choices.map((month) => (
          <option key={month} value={month}>
            {monthName(month)}
          </option>
        ))}
      </select>

      <button
        onClick={() => {
          setOpen(false)
          onChange(ytdPeriod(latestDay(choices)))
        }}
        className={pill(period.kind === 'ytd')}
      >
        Year to date
      </button>

      <button onClick={() => setOpen((v) => !v)} className={pill(period.kind === 'range')}>
        Custom
      </button>

      {open && (
        <span className="flex items-center gap-1.5">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5 text-xs text-ink-700"
          />
          <span className="text-xs text-ink-400">to</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5 text-xs text-ink-700"
          />
          <button
            onClick={() => {
              onChange(rangePeriod(start, end))
              setOpen(false)
            }}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            Apply
          </button>
        </span>
      )}
    </div>
  )
}

const pill = (active: boolean) =>
  active
    ? 'rounded-full bg-tide-600 px-3.5 py-1.5 text-xs font-medium text-white'
    : 'rounded-full border border-sand-300 px-3.5 py-1.5 text-xs text-ink-700 transition hover:bg-sand-100'

/**
 * Year to date means "through today" for a live budget, but a fixture or an
 * archive can end in the past — running it to today would show an empty year.
 */
function latestDay(months: string[]): string {
  const now = today()
  const newest = months.slice().sort().at(-1)
  if (!newest || newest >= now.slice(0, 7)) return now
  return monthPeriod(newest).end
}

/** The month to land on: the current one if it has anything, else the newest that does. */
export function defaultPeriod(months: string[]): Period {
  const now = today().slice(0, 7)
  if (months.includes(now) || months.length === 0) return monthPeriod(now)
  return monthPeriod(months.slice().sort().at(-1)!)
}
