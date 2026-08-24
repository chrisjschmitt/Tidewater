import { moneyPrecise } from '../../lib/format'
import { monthName } from '../../lib/etm/period'
import type { ClosedPlanPoint } from '../../lib/etm/closedPlan'
import { shortMonth } from './forecastCopy'

interface Props {
  points: ClosedPlanPoint[]
  highlighted: Set<string>
}

/**
 * Closed months only: the typical-month spend kept at close, beside what
 * actually posted. Not the live dashboard sliders, and not Forecast.
 */
export default function ClosedPlanTrend({ points, highlighted }: Props) {
  if (points.length === 0) return null

  const width = 720
  const height = 148
  const pad = { top: 10, right: 6, bottom: 32, left: 6 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const colW = innerW / points.length
  const barW = Math.min(colW * 0.36, 28)

  const peak = Math.max(...points.flatMap((point) => [point.planned, point.actual]), 1)
  const y = (value: number) => pad.top + innerH - (value / peak) * innerH
  const h = (value: number) => Math.max(0, (value / peak) * innerH)

  return (
    <section className="card p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">
          What you chose to budget
        </h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Each closed month keeps the typical-month spend as it stood that day,
          so you can see how the plan has moved against what posted. Groups
          below still follow today&apos;s sliders.
        </p>
      </header>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Chosen typical-month spend beside actual spending, for months that have been closed"
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--color-sand-200)"
          strokeWidth="1"
        />
        {points.map((point, i) => {
          const x0 = pad.left + i * colW
          const active = highlighted.has(point.month)
          return (
            <g key={point.month}>
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
                y={y(point.planned)}
                width={barW}
                height={h(point.planned)}
                fill="var(--color-sand-300)"
                rx="1.5"
              />
              <rect
                x={x0 + colW * 0.12 + barW + 2}
                y={y(point.actual)}
                width={barW}
                height={h(point.actual)}
                fill="var(--color-tide-600)"
                rx="1.5"
              />
              {(points.length <= 12 || i % 2 === 0) && (
                <text
                  x={x0 + colW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fill="var(--color-ink-400)"
                  fontSize="9"
                >
                  {shortMonth(point.month)}
                </text>
              )}
              <title>
                {monthName(point.month)} · chosen {Math.round(point.planned)} · actual{' '}
                {Math.round(point.actual)}
              </title>
            </g>
          )
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-sand-300" /> chosen at close
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-tide-600" /> actually spent
          </span>
        </span>
        {points.length === 1 && (
          <span>
            {monthName(points[0]!.month)} kept {moneyPrecise(points[0]!.planned)}
          </span>
        )}
      </div>
    </section>
  )
}
