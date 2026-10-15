import Modal from '../Modal'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { CategoryExplanation, ExpenseType, ExplainStep, TypicalHow } from '../../lib/forecast/types'
import { TYPE_CHOICES, confidenceLabel, remainReasonCopy, shortMonth, typeLabel } from './forecastCopy'

interface Props {
  explanation: CategoryExplanation
  /** The category's type override, if one is set. */
  overrideType?: ExpenseType
  onChangeType: (type: ExpenseType | 'auto') => void
  onIgnoreMonth: (month: string, ignored: boolean) => void
  /** Opens one month's transactions for this category. */
  onOpenMonth: (month: string) => void
  onClose: () => void
}

const cad = (amount: number) => amountIn(amount, 'CAD')

/**
 * Why a category's Forecast figure is what it is. Everything shown comes
 * from `explainCategory`, so the steps add up to the figure that was clicked.
 */
export default function ForecastExplainModal({
  explanation: e,
  overrideType,
  onChangeType,
  onIgnoreMonth,
  onOpenMonth,
  onClose,
}: Props) {
  const name = monthName(e.month)
  const largest = Math.max(1, ...e.history.map((m) => Math.abs(m.amount)))
  const selectedType = overrideType ?? 'auto'

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={e.label}
      subtitle={`${cad(e.figure)} forecast for ${name}${e.kind === 'current' ? ' (to month-end)' : ''}`}
    >
      <div className="space-y-6 text-sm text-ink-500">
        <section className="rounded-2xl bg-white/70 px-4 py-4">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">In short</p>
          {e.category ? (
            <>
              <p className="mt-1 text-ink-900">
                Treated as <strong className="font-semibold">{typeLabel(e.category.type, e.category.lowSample).toLowerCase()}</strong>
                {e.typeOverridden
                  ? ` — set by you; history alone says ${typeLabel(e.category.suggestedType, e.category.lowSample).toLowerCase()}.`
                  : ' — from its history.'}{' '}
                {confidenceLabel(e.category.confidence)}.
              </p>
              <p className="mt-1">{summaryCopy(e)}</p>
            </>
          ) : (
            <p className="mt-1 text-ink-900">
              No spending in the history window and no plan line, so nothing comes from history.
            </p>
          )}
          {e.kind === 'past' && (
            <p className="mt-1 text-xs text-ink-400">
              A past month is reconstructed with today’s history — not the number you would have seen at the time.
            </p>
          )}

          {e.category && (
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wider text-ink-400">Change type</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {TYPE_CHOICES.map(([id, label]) => {
                  const active = selectedType === id
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeType(id)}
                      className={
                        active
                          ? 'rounded-full bg-tide-600 px-3 py-1.5 text-xs font-medium text-white'
                          : 'btn-quiet text-xs'
                      }
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-ink-400">The forecast recalculates straight away. History lets the pattern decide.</p>
            </div>
          )}
        </section>

        {e.current && (
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">This month so far</p>
            <p className="mt-1 text-base text-ink-900">{currentCopy(e)}</p>
            <p className="mt-1 text-xs text-ink-400">
              The rule for the month in progress: spending so far, plus whatever is left of the usual amount — never
              less than what has already been spent.{' '}
              {e.current.spent !== 0 && (
                <button
                  type="button"
                  className="underline decoration-sand-300 underline-offset-2 hover:text-ink-900"
                  onClick={() => onOpenMonth(e.month)}
                >
                  See this month’s transactions
                </button>
              )}
            </p>
          </section>
        )}

        <section>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">How the figure is built</p>
          {e.kind === 'current' && (
            <p className="mt-1">
              Usual amount for {name}: <span className="tabular-nums text-ink-700">{cad(e.typical.amount)}</span> —{' '}
              {howCopy(e.typical.how, e.month)}.
            </p>
          )}
          <ul className="mt-2 divide-y divide-sand-200/80">
            {e.steps.map((step, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="min-w-0">
                  <span className="block text-ink-900">
                    {i > 0 && <span className="mr-1 text-ink-400">{step.amount < 0 ? '−' : '+'}</span>}
                    {stepLabel(step)}
                  </span>
                  {stepDetail(step, e.month) && <span className="text-xs text-ink-400">{stepDetail(step, e.month)}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-ink-700">{cad(i > 0 ? Math.abs(step.amount) : step.amount)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-4 border-t border-sand-300 py-1.5">
              <span className="font-medium text-ink-900">= Forecast</span>
              <span className="shrink-0 font-medium tabular-nums text-ink-900">{cad(e.figure)}</span>
            </li>
          </ul>
          {e.planRaises.length > 0 && (
            <p className="mt-2 text-xs text-ink-400">
              A raise of {cad(e.planRaises.reduce((sum, raise) => sum + raise.amount, 0))} sits on this month’s plan. It
              moves Plan, not Forecast.
            </p>
          )}
        </section>

        <section>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Month by month</p>
          <p className="mt-1">
            The history this forecast learned from, newest first. Click an amount to see its transactions. Ignore a
            month that should not count — a one-off spike, say; its spend still shows as actual.
          </p>
          {e.history.length === 0 ? (
            <p className="mt-2">No full months of history yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-sand-200/80">
              {[...e.history].reverse().map((m) => (
                <li key={m.month} className={`flex items-center gap-3 py-1.5 ${m.ignored ? 'text-ink-300' : ''}`}>
                  <span className={`w-20 shrink-0 ${m.ignored ? 'text-ink-300' : 'text-ink-700'}`}>
                    {shortMonth(m.month)} {m.month.slice(0, 4)}
                  </span>
                  <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-sand-100 sm:block">
                    <span
                      className={`block h-full rounded-full ${m.ignored ? 'bg-sand-200' : 'bg-tide-300'}`}
                      style={{ width: `${Math.max(0, (m.amount / largest) * 100)}%` }}
                    />
                  </span>
                  <span className="ml-auto w-24 shrink-0 text-right tabular-nums sm:ml-0">
                    {m.amount !== 0 ? (
                      <button
                        type="button"
                        onClick={() => onOpenMonth(m.month)}
                        className={`tabular-nums underline decoration-sand-300 underline-offset-2 hover:text-ink-900 ${
                          m.ignored ? 'text-ink-300 line-through' : 'text-ink-700'
                        }`}
                        aria-label={`Transactions behind ${e.label} in ${monthName(m.month)}`}
                      >
                        {cad(m.amount)}
                      </button>
                    ) : (
                      <span className={m.ignored ? 'text-ink-300' : 'text-ink-400'}>{cad(0)}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onIgnoreMonth(m.month, !m.ignored)}
                    className="btn-quiet w-36 shrink-0 text-xs"
                  >
                    {m.ignored ? 'Use this month' : 'Ignore this month'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}

function summaryCopy(e: CategoryExplanation): string {
  const c = e.category!
  const ignored = e.history.filter((m) => m.ignored).length
  const window = `${e.windowMonths} month${e.windowMonths === 1 ? '' : 's'}`
  const parts: string[] = []
  let seen =
    c.monthsPresent === 0
      ? `Nothing spent in the last ${window}`
      : `Spent in ${c.monthsPresent} of the last ${window}`
  if (ignored > 0) seen += ` (${ignored} ignored month${ignored === 1 ? '' : 's'} left out)`
  const monthly = c.type === 'predictable-monthly' || c.type === 'variable-monthly'
  if (c.usedPlanPrior) {
    parts.push(`${seen}.`)
  } else if (monthly && c.monthsPresent > 0) {
    parts.push(`${seen}, usually about ${cad(c.likely)}.`)
    if (c.low < c.high) parts.push(`Most months fall between ${cad(c.low)} and ${cad(c.high)}.`)
  } else if ((c.type === 'predictable-annual' || c.type === 'seasonal') && c.monthsPresent > 0) {
    const when = c.typicalMonthNames.length > 0 ? `, in ${c.typicalMonthNames.join(', ')}` : ''
    parts.push(`${seen}${when} — about ${cad(c.meanPresent)} when it lands.`)
    if (c.type === 'predictable-annual' && c.repeatedCycle) parts.push('It has come back in the same month in more than one year.')
  } else if (c.monthsPresent > 0) {
    parts.push(`${seen}, about ${cad(c.meanPresent)} when it happens.`)
  } else {
    parts.push(`${seen}.`)
  }
  if (c.usedPlanPrior) parts.push('Your Budget plan stands in until this category has a monthly pattern of its own.')
  if (c.usedLastAmount) parts.push('It barely changes, so the latest amount is taken as the new level.')
  if (c.lowSample && c.monthsPresent > 0) parts.push('That is only a few months, so treat this as an early guess.')
  if (c.average12 > 0) {
    parts.push(
      `Spread over every month, that averages ${cad(c.average12)} a month over the last year${
        c.average24 != null ? ` and ${cad(c.average24)} over two` : ''
      }.`,
    )
  }
  return parts.join(' ')
}

function howCopy(how: TypicalHow, month: string): string {
  const word = monthName(month).split(' ')[0]
  switch (how.kind) {
    case 'plan-prior':
      return `your Budget plan for this category (${cad(how.plan)}), standing in until history looks monthly`
    case 'override':
      return 'the amount you set for this category'
    case 'last-amount':
      return 'the latest month’s amount — it barely changes, so the newest level is used'
    case 'median-recent':
      return `the middle value of the last ${how.months} month${how.months === 1 ? '' : 's'} it was spent`
    case 'median-all':
      return `the middle value of the ${how.months} months since it first appeared, counting $0 months`
    case 'mean-present':
      return `the average of the ${how.months} time${how.months === 1 ? '' : 's'} it landed`
    case 'seasonal-same-month':
      return `the average of past ${word}s (${how.months})`
    case 'seasonal-mean-present':
      return `the average of the months it was spent — no past ${word} to go on`
    case 'off-month':
      return how.typicalMonthNames.length > 0
        ? `not expected in ${word} — it usually lands in ${how.typicalMonthNames.join(', ')}`
        : `not expected in ${word}`
    case 'irregular':
      return how.share > 0
        ? `irregular, so no month is assumed; its ${cad(how.share)} a month share sits in Risk until you pin it`
        : 'irregular, so no month is assumed'
    case 'no-history':
      return 'no history and no plan line'
  }
}

function stepLabel(step: ExplainStep): string {
  switch (step.kind) {
    case 'typical':
      return 'Typical amount'
    case 'inflation':
      return 'Inflation'
    case 'pin':
      return step.recurrence === 'annual' ? 'Dated cost (each year)' : 'Dated cost'
    case 'spent':
      return 'Spent so far'
    case 'expected':
      return 'Still expected'
  }
}

function stepDetail(step: ExplainStep, month: string): string {
  switch (step.kind) {
    case 'typical':
      return sentenceCase(howCopy(step.how, month))
    case 'inflation':
      return `${step.percent}% a year, ${step.monthsAhead} month${step.monthsAhead === 1 ? '' : 's'} ahead`
    case 'pin':
      return step.notes ? `Pinned on this month — “${step.notes}”` : 'Pinned on this month'
    case 'spent':
      return ''
    case 'expected':
      return step.reason
        ? `${sentenceCase(remainReasonCopy(step.reason))} (${cad(step.typical)})`
        : `Toward ${cad(step.typical)}`
  }
}

function currentCopy(e: CategoryExplanation): string {
  const c = e.current!
  switch (c.outcome) {
    case 'still-expected':
      return `${cad(c.spent)} spent so far + ${cad(c.expected)} still expected = ${cad(e.figure)}.`
    case 'reached':
      return `${cad(c.spent)} spent so far — the usual ${cad(c.typical)} — so nothing more is expected. Forecast is ${cad(e.figure)}.`
    case 'over':
      return `Already over: ${cad(c.spent)} spent so far against a usual ${cad(c.typical)}, so spending so far is the forecast (${cad(e.figure)}).`
    case 'posted':
      return `Already posted this month (${cad(c.spent)}), so it is not expected again. Spending so far is the forecast.`
    case 'spent-only':
      return `${cad(c.spent)} spent so far, and no pattern says more is coming. Spending so far is the forecast.`
    case 'nothing':
      return 'Nothing spent yet, and nothing is expected this month.'
  }
}

const sentenceCase = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text)
