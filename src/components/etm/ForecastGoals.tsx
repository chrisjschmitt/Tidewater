import { amountIn } from '../../lib/etm/format'
import { householdGoalCount } from '../../lib/forecast/snapshot'
import type { CoverageResult, VacationGoalMatch } from '../../lib/forecast/types'
import type { Goal } from '../../lib/types'
import { fundedGoalCopy, unfundedGoalCopy } from './forecastCopy'

interface Props {
  coverage: CoverageResult
  goals: Goal[]
  vacationGoal: VacationGoalMatch
  onApplyContribution?: (monthly: number, vacationGoalId?: string) => void
}

export default function ForecastGoals({ coverage, goals, vacationGoal, onApplyContribution }: Props) {
  const vacationId = vacationGoal.status === 'matched' ? vacationGoal.goalId : undefined
  const householdGoals = householdGoalCount(goals, vacationId)
  const clearing = coverage.contributionThatWouldClear
  const differs = Math.abs(clearing - coverage.householdCommitted) >= 0.01
  const canApply = Boolean(onApplyContribution) && householdGoals > 0 && clearing > 0 && differs

  return (
    <section className="card p-6">
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Household goals</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Judged on whether the contribution would have been affordable in about 9 months out of 10.
          Vacation stays on its own card.
        </p>
      </header>

      {householdGoals === 0 ? (
        <p className="text-sm text-ink-500">
          No household savings contribution on the budget yet. Vacation, if you have one, is on its
          own card.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label="Household contribution" amount={coverage.householdCommitted} />
            <Figure
              label="Months that covered it"
              value={`${coverage.monthsHit} of ${coverage.monthsConsidered}`}
            />
            <Figure
              label="Would clear 9 of 10"
              amount={clearing}
              hint="the contribution that would have been affordable in about 9 months out of 10"
            />
          </div>

          <p className="mt-4 max-w-prose text-sm text-ink-500">
            {coverage.monthsConsidered === 0
              ? 'There is not enough history yet to judge coverage.'
              : coverage.funded
                ? fundedGoalCopy(coverage.monthsHit, coverage.monthsConsidered)
                : unfundedGoalCopy(
                    coverage.monthsHit,
                    coverage.monthsConsidered,
                    amountIn(coverage.householdCommitted, 'CAD'),
                    amountIn(clearing, 'CAD'),
                  )}
          </p>

          {canApply && (
            <button
              onClick={() => onApplyContribution?.(clearing, vacationId)}
              className="btn-ghost mt-4 text-xs"
            >
              Use {amountIn(clearing, 'CAD')} as my monthly household contribution
            </button>
          )}
        </>
      )}
    </section>
  )
}

function Figure({
  label,
  amount,
  value,
  hint,
}: {
  label: string
  amount?: number
  value?: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
        {value ?? (amount === undefined ? '—' : amountIn(amount, 'CAD'))}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
    </div>
  )
}
