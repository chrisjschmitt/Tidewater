import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { VacationForecast, VacationGoalMatch } from '../../lib/forecast/types'
import { shortMonth } from './forecastCopy'

interface Props {
  vacation: VacationForecast
  goal: VacationGoalMatch
}

export default function ForecastVacationCard({ vacation, goal }: Props) {
  const trips = vacation.months.filter((month) => month.isTravel)
  const current = vacation.months.find((month) => month.kind === 'current')
  const upcoming = vacation.months.filter((month) => month.kind !== 'past' && month.forecast > 0)

  return (
    <section className="card p-6">
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Vacation</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Its own series, paid from the vacation pot. Trip months do not inflate household “out,”
          and a travel month is not a miss on this goal.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="The pot"
          value={goal.status === 'matched' ? amountIn(vacation.pot, 'CAD') : '—'}
          hint={
            goal.status === 'matched'
              ? goal.goalName
              : goal.status === 'ambiguous'
                ? 'Two budget goals could be vacation — pick one in a later setting.'
                : 'No vacation goal on the budget yet'
          }
        />
        <Figure
          label="Usual contribution"
          value={goal.status === 'matched' ? amountIn(vacation.monthlyContribution, 'CAD') : '—'}
          hint={vacation.currentMonthPaused ? 'paused this month' : 'in a non-travel month'}
        />
        <Figure
          label="Next trip months"
          value={upcoming.length > 0 ? upcoming.map((m) => shortMonth(m.month)).join(', ') : 'None in view'}
        />
      </div>

      {vacation.currentMonthPaused && current && (
        <p className="mt-4 text-sm text-ink-500">
          This month is a travel month, so the vacation contribution is paused — spending is coming
          from the vacation account, not from this month’s household cash. Household goals are
          unaffected.
        </p>
      )}

      {goal.status === 'matched' && vacation.runwayGoesNegative && vacation.firstShortfallMonth && (
        <p className="mt-4 text-sm text-ink-500">
          The pot would run short around {monthName(vacation.firstShortfallMonth)}, before a planned
          trip is fully covered.
        </p>
      )}

      {goal.status === 'matched' && !vacation.runwayGoesNegative && upcoming.length > 0 && (
        <p className="mt-4 text-sm text-ink-500">
          Opening balance {amountIn(vacation.pot, 'CAD')}, plus contributions in non-travel months,
          looks enough for the trips in view.
        </p>
      )}

      {trips.length > 0 && (
        <ul className="mt-5 divide-y divide-sand-200/80">
          {trips.map((month) => (
            <li key={month.month} className="flex items-baseline justify-between gap-4 py-2">
              <span className="text-sm text-ink-900">
                {monthName(month.month)}
                {month.kind === 'past' ? (
                  <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-400">trip</span>
                ) : (
                  <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-400">likely</span>
                )}
              </span>
              <span className="text-sm tabular-nums text-ink-700">
                {amountIn(month.kind === 'past' ? month.actual : month.forecast, 'CAD')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {trips.length === 0 && (
        <p className="mt-4 text-sm text-ink-400">No vacation-tagged months in this view.</p>
      )}
    </section>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
    </div>
  )
}
