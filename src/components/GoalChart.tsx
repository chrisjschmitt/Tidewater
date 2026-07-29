import { useMemo } from 'react'
import { money } from '../lib/format'
import { project } from '../lib/goals'
import type { Goal } from '../lib/types'

interface Props {
  goal: Goal
  months: number
  color?: string
  height?: number
}

/**
 * Balance over time, with the portion you contributed shaded underneath and
 * growth shown as the space above it.
 */
export default function GoalChart({ goal, months, color = 'var(--color-tide-600)', height = 150 }: Props) {
  const points = useMemo(() => project(goal, months), [goal, months])

  const width = 640
  const pad = { top: 12, right: 8, bottom: 18, left: 8 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom

  const maxValue = Math.max(
    goal.kind === 'debt' ? goal.current : goal.target,
    ...points.map((p) => p.balance),
    1,
  )

  const x = (m: number) => pad.left + (m / Math.max(1, months)) * innerW
  const y = (v: number) => pad.top + innerH - (v / maxValue) * innerH

  const line = (key: 'balance' | 'contributed') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.month).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')

  const area = `${line('contributed')} L${x(months)},${y(0)} L${x(0)},${y(0)} Z`
  const growthArea = `${line('balance')} ${points
    .slice()
    .reverse()
    .map((p) => `L${x(p.month).toFixed(1)},${y(p.contributed).toFixed(1)}`)
    .join(' ')} Z`

  const targetY = goal.kind === 'debt' ? y(0) : y(goal.target)
  const showTarget = goal.kind === 'savings' && goal.target > 0 && goal.target <= maxValue * 1.02
  const final = points[points.length - 1]

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img"
        aria-label={`Projection for ${goal.name}`}>
        <defs>
          <linearGradient id={`fill-${goal.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * f}
            y2={pad.top + innerH * f}
            stroke="var(--color-sand-200)"
            strokeWidth="1"
          />
        ))}

        {goal.kind === 'savings' && <path d={growthArea} fill={`url(#fill-${goal.id})`} />}
        <path d={area} fill={color} opacity="0.1" />

        {goal.kind === 'savings' && (
          <path d={line('contributed')} fill="none" stroke="var(--color-ink-400)" strokeWidth="1.5" strokeDasharray="4 4" />
        )}
        <path d={line('balance')} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />

        {showTarget && (
          <>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={targetY}
              y2={targetY}
              stroke="var(--color-shell-500)"
              strokeWidth="1.5"
              strokeDasharray="6 5"
            />
            <text x={pad.left + 4} y={targetY - 5} fill="var(--color-shell-500)" fontSize="11">
              target {money(goal.target)}
            </text>
          </>
        )}

        <circle cx={x(months)} cy={y(final.balance)} r="4" fill={color} />
      </svg>

      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-400">
        <span>today</span>
        {goal.kind === 'savings' && (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 border-t border-dashed border-ink-400" /> what you put in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ background: color }} /> with growth
            </span>
          </span>
        )}
        <span>{months >= 12 ? `${Math.round(months / 12)} years` : `${months} months`}</span>
      </div>
    </div>
  )
}
