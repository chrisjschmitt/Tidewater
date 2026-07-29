import { money, percent } from '../lib/format'

interface Props {
  income: number
  spending: number
  goals: number
  size?: number
}

/**
 * One ring, read from the top clockwise: everyday spending, then goals, then
 * whatever remains. The gap at the end is the point of the whole app.
 */
export default function SummaryRing({ income, spending, goals, size = 260 }: Props) {
  const stroke = 18
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const safeIncome = Math.max(income, 1)

  const spendShare = Math.min(1, spending / safeIncome)
  const goalShare = Math.min(1 - spendShare, goals / safeIncome)
  const leftShare = Math.max(0, 1 - spendShare - goalShare)
  const left = income - spending - goals
  const over = left < 0

  const arc = (share: number, offsetShare: number, color: string, key: string) => (
    <circle
      key={key}
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeDasharray={`${Math.max(0, share * circumference - 3)} ${circumference}`}
      strokeDashoffset={-offsetShare * circumference}
      style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.22,1,0.36,1), stroke-dashoffset 500ms' }}
    />
  )

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-sand-200)"
            strokeWidth={stroke}
          />
          {arc(spendShare, 0, over ? 'var(--color-shell-500)' : 'var(--color-tide-600)', 'spend')}
          {goalShare > 0.002 && arc(goalShare, spendShare, 'var(--color-tide-300)', 'goals')}
          {leftShare > 0.002 && arc(leftShare, spendShare + goalShare, 'var(--color-sand-300)', 'left')}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="label">{over ? 'Short by' : 'Unspoken for'}</span>
          <span
            className={`mt-1 text-4xl font-semibold tracking-tight ${
              over ? 'text-shell-500' : 'text-ink-900'
            }`}
          >
            {money(Math.abs(left))}
          </span>
          <span className="mt-1 text-xs text-ink-400">
            of {money(income)} each month
          </span>
        </div>
      </div>

      <dl className="mt-6 grid w-full grid-cols-3 gap-2 text-center">
        <Legend swatch="var(--color-tide-600)" label="Living" value={money(spending)} sub={percent(spendShare)} />
        <Legend swatch="var(--color-tide-300)" label="Goals" value={money(goals)} sub={percent(goalShare)} />
        <Legend
          swatch="var(--color-sand-300)"
          label="Free"
          value={money(Math.max(0, left))}
          sub={percent(leftShare)}
        />
      </dl>
    </div>
  )
}

function Legend({
  swatch,
  label,
  value,
  sub,
}: {
  swatch: string
  label: string
  value: string
  sub: string
}) {
  return (
    <div>
      <dt className="flex items-center justify-center gap-1.5 text-xs text-ink-500">
        <span className="h-2 w-2 rounded-full" style={{ background: swatch }} />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-ink-900">{value}</dd>
      <dd className="text-[11px] text-ink-400">{sub}</dd>
    </div>
  )
}
