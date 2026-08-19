import type { MonthPoint } from '../../lib/forecast/types'
import { shortMonth } from './forecastCopy'

interface Props {
  calendar: MonthPoint[]
  selected: string
  onSelect: (month: string) => void
}

/**
 * Previous 12 full months + next 12. Past columns are actual vs forecast;
 * future columns are plan vs forecast. The overlay is a quiet line, not a
 * bar, so a flat month is not mistaken for a cheap one.
 */
export default function ForecastTimeline({ calendar, selected, onSelect }: Props) {
  const width = 720
  const height = 156
  const pad = { top: 10, right: 6, bottom: 32, left: 6 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const colW = calendar.length > 0 ? innerW / calendar.length : innerW
  const barW = colW * 0.36

  const overlay = calendar[0]?.overlay ?? 0
  const peak = Math.max(
    overlay,
    ...calendar.flatMap((point) => [point.actual, point.calendar, point.plan]),
    1,
  )
  const y = (value: number) => pad.top + innerH - (value / peak) * innerH
  const h = (value: number) => Math.max(0, (value / peak) * innerH)

  return (
    <section className="card p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Household timeline</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Twelve months behind and twelve ahead. Vacation spend is not in these bars.
        </p>
      </header>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Household spend, previous twelve months and next twelve"
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--color-sand-200)"
          strokeWidth="1"
        />
        {overlay > 0 && (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(overlay)}
            y2={y(overlay)}
            stroke="var(--color-ink-400)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        )}

        {calendar.map((point, i) => {
          const x0 = pad.left + i * colW
          const left = point.kind === 'future' ? point.plan : point.actual
          const right = point.calendar
          const active = point.month === selected
          const tint = point.kind !== 'past' && point.outsideControlWindow
          return (
            <g key={point.month}>
              {tint && (
                <rect
                  x={x0}
                  y={pad.top}
                  width={colW}
                  height={innerH}
                  fill="var(--color-shell-300)"
                  opacity="0.18"
                />
              )}
              {active && (
                <rect
                  x={x0}
                  y={pad.top - 2}
                  width={colW}
                  height={innerH + 4}
                  fill="var(--color-tide-100)"
                  rx="3"
                />
              )}
              <rect
                x={x0 + colW * 0.12}
                y={y(left)}
                width={barW}
                height={h(left)}
                fill={point.kind === 'future' ? 'var(--color-sand-300)' : 'var(--color-tide-600)'}
                rx="1.5"
              />
              <rect
                x={x0 + colW * 0.12 + barW + 2}
                y={y(right)}
                width={barW}
                height={h(right)}
                fill={point.kind === 'future' ? 'var(--color-tide-500)' : 'var(--color-sand-300)'}
                rx="1.5"
              />
              {(i % 2 === 0 || point.kind === 'current') && (
                <text
                  x={x0 + colW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fill={point.kind === 'current' ? 'var(--color-tide-700)' : 'var(--color-ink-400)'}
                  fontSize="9"
                >
                  {shortMonth(point.month)}
                </text>
              )}
              <rect
                x={x0}
                y={0}
                width={colW}
                height={height}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => onSelect(point.month)}
              >
                <title>
                  {point.month}
                  {point.kind === 'future'
                    ? ` · plan ${Math.round(point.plan)} · forecast ${Math.round(point.calendar)}`
                    : ` · actual ${Math.round(point.actual)} · forecast ${Math.round(point.calendar)}`}
                </title>
              </rect>
            </g>
          )
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-tide-600" /> actual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-sand-300" /> plan / reconstructed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-tide-500" /> forecast
          </span>
          {overlay > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-4 border-t border-dashed border-ink-400" /> still
              unplaced
            </span>
          )}
        </span>
        <span>Click a month to read it</span>
      </div>
    </section>
  )
}
