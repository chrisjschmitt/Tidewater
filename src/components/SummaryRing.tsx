import { money, percent } from '../lib/format'
import type { DashboardActuals } from '../lib/etm/aggregate'

interface Props {
  income: number
  spending: number
  goals: number
  size?: number
  /**
   * Present only while the expense module is unlocked. Type-only, so nothing
   * of that module is reachable from here in a build without it.
   */
  actuals?: DashboardActuals | null
}

/**
 * One ring, read from the top clockwise: everyday spending, then goals, then
 * whatever remains. The gap at the end is the point of the whole app.
 *
 * With the expense module unlocked a second, thinner ring sits inside it,
 * reading the same way but from what actually happened. The two are never
 * added together, and the inner one is drawn against its own income so it
 * stays honest when a month came in higher or lower than planned.
 */
export default function SummaryRing({ income, spending, goals, size = 260, actuals }: Props) {
  // Folds to a constant null in public builds, taking the inner ring with it.
  const overlay = __ETM_AVAILABLE__ ? (actuals ?? null) : null
  const stroke = 18
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const safeIncome = Math.max(income, 1)

  const spendShare = Math.min(1, spending / safeIncome)
  const goalShare = Math.min(1 - spendShare, goals / safeIncome)
  const leftShare = Math.max(0, 1 - spendShare - goalShare)
  const left = income - spending - goals
  const over = left < 0

  const innerRadius = radius - stroke
  const innerCircumference = 2 * Math.PI * innerRadius
  const actualIncome = overlay?.income.CAD ?? 0
  const actualSpend = overlay?.spend.CAD ?? 0
  const actualShare = Math.min(1, actualSpend / Math.max(actualIncome, 1))
  const actualOver = actualSpend > actualIncome

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

          {overlay && (
            <>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={innerRadius}
                fill="none"
                stroke="var(--color-sand-200)"
                strokeWidth={8}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={innerRadius}
                fill="none"
                stroke={actualOver ? 'var(--color-shell-500)' : 'var(--color-ink-700)'}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0, actualShare * innerCircumference - 3)} ${innerCircumference}`}
                style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.22,1,0.36,1)' }}
              />
            </>
          )}
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

      {overlay && (
        <div className="mt-5 w-full rounded-2xl bg-white/70 px-4 py-3 animate-fade">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            What actually happened · {overlay.label}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-center">
            <Legend
              swatch="var(--color-tide-600)"
              label="Came in"
              value={money(actualIncome)}
              sub={usdNote(overlay.income.USD)}
            />
            <Legend
              swatch={actualOver ? 'var(--color-shell-500)' : 'var(--color-ink-700)'}
              label="Went out"
              value={money(actualSpend)}
              sub={usdNote(overlay.spend.USD)}
            />
          </dl>
          {overlay.months > 1 && (
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Over {overlay.months} months. The plan above is monthly.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** US dollars are never folded into a Canadian total, so they sit beside it. */
const usdNote = (amount: number) =>
  amount === 0 ? '' : `+ US$${Math.round(Math.abs(amount)).toLocaleString()}`

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
