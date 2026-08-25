import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { VacationForecast, VacationGoalMatch } from '../../lib/forecast/types'
import { shortMonth } from './forecastCopy'

interface Props {
  vacation: VacationForecast
  goal: VacationGoalMatch
}

export default function ForecastVacationCard({ vacation, goal }: Props) {
  const draws = vacation.months.filter((month) => month.isTravel)
  const current = vacation.months.find((month) => month.kind === 'current')
  const upcoming = vacation.months.filter((month) => month.kind !== 'past' && month.forecast > 0)
  const currentDraw = Boolean(current && current.actual > 0)

  return (
    <section className="card p-6">
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Vacation</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Its own series, paid from the vacation pot. Monthly savings still go in every month.
          Vacation-tagged spend — a prepayment or a trip — comes out on the day it posts. The
          warning is a pot that would go below zero.
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
          label="Savings in each month"
          value={amountIn(vacation.monthlyContribution, 'CAD')}
          hint="leftover after household life and household goals — never paused"
        />
        <Figure
          label="Next vacation draws"
          value={upcoming.length > 0 ? upcoming.map((m) => shortMonth(m.month)).join(', ') : 'None in view'}
        />
      </div>

      {currentDraw && current && (
        <p className="mt-4 text-sm text-ink-500">
          Vacation-tagged spend of {amountIn(current.actual, 'CAD')} has posted this month, so it
          comes out of the pot (a prepayment or a trip). The savings sweep still goes in.
          Household goals are unaffected.
        </p>
      )}

      {goal.status === 'matched' && vacation.runwayGoesNegative && vacation.firstShortfallMonth && (
        <p className="mt-4 text-sm text-ink-500">
          The pot would go below zero around {monthName(vacation.firstShortfallMonth)}.
        </p>
      )}

      {goal.status === 'matched' && !vacation.runwayGoesNegative && upcoming.length > 0 && (
        <p className="mt-4 text-sm text-ink-500">
          Opening balance {amountIn(vacation.pot, 'CAD')}, plus the savings sweep each month, looks
          enough for the draws in view.
        </p>
      )}

      {draws.length > 0 && (
        <ul className="mt-5 divide-y divide-sand-200/80">
          {draws.map((month) => (
            <li key={month.month} className="flex items-baseline justify-between gap-4 py-2">
              <span className="text-sm text-ink-900">
                {monthName(month.month)}
                <span className="ml-2 text-[11px] uppercase tracking-wider text-ink-400">
                  {month.kind === 'past'
                    ? 'posted'
                    : month.kind === 'current' && month.actual > 0
                      ? 'this month'
                      : 'likely'}
                </span>
              </span>
              <span className="text-sm tabular-nums text-ink-700">
                {amountIn(
                  month.kind === 'future' ? month.forecast : Math.max(month.actual, month.forecast),
                  'CAD',
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {draws.length === 0 && (
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
