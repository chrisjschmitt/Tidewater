import type { MonthPoint, TimelineStack } from '../../lib/forecast/types'
import { HOUSEHOLD_STACK_KEY, normalizeTag } from '../../lib/forecast/universe'
import { shortMonth } from './forecastCopy'

const HOUSEHOLD_FILL = 'var(--color-tide-600)'
const PLAN_FILL = 'var(--color-sand-300)'
const BUCKET_FILLS = [
  'var(--color-sand-300)',
  'var(--color-shell-300)',
  'var(--color-tide-300)',
  'var(--color-shell-500)',
  'var(--color-tide-500)',
]

interface Props {
  calendar: MonthPoint[]
  selected: string
  allowList: string[]
  onSelect: (month: string) => void
}

function stackFill(key: string, allowList: string[]): string {
  if (key === HOUSEHOLD_STACK_KEY) return HOUSEHOLD_FILL
  const index = allowList.findIndex((tag) => normalizeTag(tag) === key)
  return BUCKET_FILLS[(index >= 0 ? index : 0) % BUCKET_FILLS.length]
}

function stackTotal(stack: TimelineStack[]): number {
  return stack.reduce((sum, segment) => sum + segment.amount, 0)
}

function fallbackStack(amount: number): TimelineStack[] {
  if (amount === 0) return []
  return [{ key: HOUSEHOLD_STACK_KEY, label: 'Household', amount }]
}

/**
 * Previous 12 full months + next 12. Past and current columns are actual
 * beside forecast; future columns are plan beside forecast. Each spend bar
 * is stacked: household at the bottom, then allow-listed reimbursable
 * buckets. The overlay is a quiet line, not a bar.
 */
export default function ForecastTimeline({ calendar, selected, allowList, onSelect }: Props) {
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
    ...calendar.flatMap((point) => [
      stackTotal(point.actualStack),
      stackTotal(point.forecastStack),
      point.actual,
      point.calendar,
      point.plan,
    ]),
    1,
  )
  const y = (value: number) => pad.top + innerH - (value / peak) * innerH
  const h = (value: number) => Math.max(0, (value / peak) * innerH)

  const legend: TimelineStack[] = []
  const seen = new Set<string>()
  for (const point of calendar) {
    for (const segment of [...point.actualStack, ...point.forecastStack]) {
      if (seen.has(segment.key) || segment.amount === 0) continue
      seen.add(segment.key)
      legend.push(segment)
    }
  }
  legend.sort((a, z) => {
    if (a.key === HOUSEHOLD_STACK_KEY) return -1
    if (z.key === HOUSEHOLD_STACK_KEY) return 1
    const ai = allowList.findIndex((tag) => normalizeTag(tag) === a.key)
    const zi = allowList.findIndex((tag) => normalizeTag(tag) === z.key)
    return (ai === -1 ? 99 : ai) - (zi === -1 ? 99 : zi) || a.label.localeCompare(z.label)
  })

  const paintStack = (stack: TimelineStack[], x: number, dimmed: boolean) => {
    let from = 0
    return stack.map((segment) => {
      const top = from + segment.amount
      const block = (
        <rect
          key={`${x}-${segment.key}`}
          x={x}
          y={y(top)}
          width={barW}
          height={h(segment.amount)}
          fill={stackFill(segment.key, allowList)}
          opacity={dimmed ? 0.72 : 1}
        />
      )
      from = top
      return block
    })
  }

  return (
    <section className="card p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Household timeline</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Twelve months behind and twelve ahead. Past months show actual beside
          forecast; ahead is plan beside forecast. Household sits at the bottom of
          each spend bar; reimbursable buckets you count as household stack above.
          Vacation is not in these bars.
        </p>
      </header>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Household actual and forecast by reimbursable bucket, previous twelve months and next twelve"
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
          const leftX = x0 + colW * 0.12
          const rightX = leftX + barW + 2
          const active = point.month === selected
          const tint = point.kind !== 'past' && point.outsideControlWindow
          const left =
            point.kind === 'future'
              ? fallbackStack(point.plan)
              : point.actualStack.length > 0
                ? point.actualStack
                : fallbackStack(point.actual)
          const right =
            point.forecastStack.length > 0 ? point.forecastStack : fallbackStack(point.calendar)
          const leftIsPlan = point.kind === 'future'
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
              {leftIsPlan ? (
                <rect
                  x={leftX}
                  y={y(point.plan)}
                  width={barW}
                  height={h(point.plan)}
                  fill={PLAN_FILL}
                  rx="1.5"
                />
              ) : (
                paintStack(left, leftX, false)
              )}
              {paintStack(right, rightX, true)}
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
          <span>Left: actual · right: forecast (ahead: plan · forecast)</span>
          {legend.map((segment) => (
            <span key={segment.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: stackFill(segment.key, allowList) }}
              />
              {segment.label}
            </span>
          ))}
          {overlay > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-4 border-t border-dashed border-ink-400" /> Risk
            </span>
          )}
        </span>
        <span>Click a month to read it</span>
      </div>
    </section>
  )
}
