import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { TravelMonth } from '../../lib/forecast/travel'
import { shortMonth } from './forecastCopy'

const TONE = {
  met: { text: 'text-green-700', chip: 'bg-green-50 text-green-700 ring-green-200' },
  close: { text: 'text-yellow-600', chip: 'bg-yellow-50 text-yellow-700 ring-yellow-200' },
  short: { text: 'text-red-600', chip: 'bg-red-50 text-red-700 ring-red-200' },
  none: { text: 'text-ink-900', chip: 'bg-white text-ink-700 ring-sand-200' },
} as const

/**
 * The point of it all, first on Overview: what this month and the next few
 * can put toward travel — planned income less forecast spend — against the
 * Vacation goal's monthly contribution. Green covers it, amber within 5%,
 * red short by more.
 */
export default function TravelSavingCard({
  months,
  goalName,
  goalId,
  goals,
  onChooseGoal,
  onSelect,
}: {
  months: TravelMonth[]
  /** The travel goal's name, or undefined when none is matched. */
  goalName?: string
  goalId?: string
  /** The budget's goals, to choose which one is the travel saving. */
  goals: Array<{ id: string; name: string; monthly: number }>
  onChooseGoal: (goalId: string) => void
  onSelect?: (month: string) => void
}) {
  const now = months[0]
  if (!now) return null
  const target = now.target
  const gap = Math.round((now.saving - target) * 100) / 100
  const verdict =
    now.tone === 'none'
      ? goalName
        ? `Set a monthly contribution on “${goalName}” (on the dashboard) to measure against.`
        : 'Choose which goal is your travel saving to measure against.'
      : now.tone === 'met'
        ? `Covers the ${amountIn(target, 'CAD')} travel saving, with ${amountIn(gap, 'CAD')} to spare.`
        : `${amountIn(-gap, 'CAD')} short of the ${amountIn(target, 'CAD')} travel saving.`
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-ink-400">
          Travel saving{goalName ? ` · ${goalName}` : ''}
        </p>
        {goals.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-ink-500">
            {goalName ? 'Goal' : 'Which goal is your travel saving?'}
            <select
              className="rounded-lg border border-sand-200 bg-white px-2 py-1 text-xs"
              value={goalId ?? ''}
              onChange={(event) => event.target.value && onChooseGoal(event.target.value)}
            >
              {!goalId && <option value="">Choose…</option>}
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                  {goal.monthly > 0 ? ` (${amountIn(goal.monthly, 'CAD')}/month)` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-2xl font-semibold tabular-nums ${TONE[now.tone].text}`}>{amountIn(now.saving, 'CAD')}</span>
        <span className="text-sm text-ink-500">forecast for {monthName(now.month)}</span>
      </div>
      <p className="mt-1 text-sm text-ink-700">{verdict}</p>
      <p className="mt-0.5 text-[11px] text-ink-400">
        Planned income {amountIn(now.income, 'CAD')} − forecast spending {amountIn(now.forecast, 'CAD')}
      </p>
      {months.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Coming months">
          {months.slice(1).map((m) => (
            <button
              key={m.month}
              type="button"
              onClick={() => onSelect?.(m.month)}
              title={`${monthName(m.month)}: income ${amountIn(m.income, 'CAD')} − forecast ${amountIn(m.forecast, 'CAD')}`}
              className={`rounded-xl px-3 py-1.5 text-left text-xs ring-1 ${TONE[m.tone].chip}`}
            >
              <span className="block text-[10px] uppercase tracking-wider opacity-70">{shortMonth(m.month)}</span>
              <span className="tabular-nums font-medium">{amountIn(m.saving, 'CAD')}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
