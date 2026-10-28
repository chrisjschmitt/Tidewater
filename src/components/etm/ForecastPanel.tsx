import { useEffect, useMemo, useState } from 'react'
import ForecastCategories from './ForecastCategories'
import ForecastGoals from './ForecastGoals'
import ForecastActualModal from './ForecastActualModal'
import ForecastExplainModal from './ForecastExplainModal'
import ForecastMonthCard from './ForecastMonthCard'
import ForecastMonthEnd from './ForecastMonthEnd'
import ForecastTimeline from './ForecastTimeline'
import ForecastVacationCard from './ForecastVacationCard'
import { taggingGapsCopy } from './forecastCopy'
import { amountIn } from '../../lib/etm/format'
import { monthName, today } from '../../lib/etm/period'
import { uid } from '../../lib/format'
import { inMonth, totalIncome } from '../../lib/budget'
import { walkForward } from '../../lib/forecast/backtest'
import { explainCategory, forecast, lookbackMonths, monthOfKnownFuture, windowLabel } from '../../lib/forecast/forecast'
import { lastFullMonth, monthEndVariance, snapshotFromResult } from '../../lib/forecast/snapshot'
import { withForecastDefaults, type ForecastConfig, type ForecastSnapshot, type PinRequest } from '../../lib/forecast/types'
import {
  taggingGaps,
  withCategoryTypicalMonths,
  withCategoryTypeOverride,
  withIgnoredCompare,
  withIgnoredHistory,
} from '../../lib/forecast/universe'
import type { Transaction } from '../../lib/etm/types'
import type { Budget } from '../../lib/types'
import { planAmountAt, planKey } from '../../lib/forecast/planHistory'
import {
  dueReviews,
  hasNotes,
  planStory,
  withChangeNote,
  withReviewed,
  withStandingNote,
  type DueReview,
  type PlanChangeRequest,
  type PlanNoteDraft,
} from '../../lib/forecast/planNotes'
import type { PlanNotesEdit } from './ForecastMonthCard'

interface Props {
  transactions: Transaction[]
  budget: Budget
  config: ForecastConfig
  reimbursableParentTag: string
  lastMonthSnapshot?: ForecastSnapshot
  onConfigChange: (config: ForecastConfig) => void
  onSnapshot: (snapshot: ForecastSnapshot) => void
  onOpenTidy: () => void
  onNotice?: (message: string) => void
  onApplyHouseholdContribution?: (monthly: number, vacationGoalId?: string) => void
  /** Changes a category's plan from a month on (planHistory.ts). */
  onPlanChange?: (change: PlanChangeRequest) => void
  /** Raises a category's plan for one month, or from that month on (`onward`). */
  onPlanRaise?: (raise: { key: string; label: string; month: string; amount: number; onward: boolean; note?: PlanNoteDraft }) => void
  /** Opens the shared editor on a TD or manual row from a drill-in. */
  onEdit?: (row: Transaction) => void
}

export default function ForecastPanel({
  transactions,
  budget,
  config,
  reimbursableParentTag,
  lastMonthSnapshot,
  onConfigChange,
  onSnapshot,
  onOpenTidy,
  onNotice,
  onApplyHouseholdContribution,
  onPlanChange,
  onPlanRaise,
  onEdit,
}: Props) {
  const asOf = today()
  const currentMonth = asOf.slice(0, 7)
  const [focusedMonth, setFocusedMonth] = useState(currentMonth)
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [openActual, setOpenActual] = useState<{ key: string; label: string; month: string } | null>(null)
  const [openExplain, setOpenExplain] = useState<{ key: string; label: string; month: string } | null>(null)
  const [openPlanKey, setOpenPlanKey] = useState<string | null>(null)
  const resolvedConfig = useMemo(() => withForecastDefaults(config), [config])

  const lookback = useMemo(
    () => lookbackMonths(asOf, config.window, transactions.length ? oldestDate(transactions) : undefined),
    [asOf, config.window, transactions],
  )
  const result = useMemo(
    () => forecast(transactions, budget, config, asOf, reimbursableParentTag),
    [transactions, budget, config, asOf, reimbursableParentTag],
  )
  useEffect(() => {
    if (transactions.length === 0) return
    onSnapshot(snapshotFromResult(result, currentMonth))
  }, [currentMonth, onSnapshot, result, transactions.length])
  const priorMonth = lastFullMonth(asOf)
  const lastPoint = result.cad.household.calendar.find((point) => point.month === priorMonth)
  const reconstructedMonth = useMemo(() => {
    if (transactions.length === 0 || lastMonthSnapshot) return null
    return (
      walkForward(transactions, budget, config, asOf, reimbursableParentTag).months.find(
        (row) => row.month === priorMonth,
      ) ?? null
    )
  }, [asOf, budget, config, lastMonthSnapshot, priorMonth, reimbursableParentTag, transactions])
  const lastVariance = useMemo(() => {
    if (transactions.length === 0) return null
    return monthEndVariance({
      month: priorMonth,
      actual: lastPoint?.actual ?? 0,
      actualByCategory: lastPoint?.byCategory ?? [],
      snapshot: lastMonthSnapshot,
      reconstructed: reconstructedMonth
        ? {
            forecast: reconstructedMonth.forecast,
            byCategory: reconstructedMonth.byCategory,
          }
        : null,
    })
  }, [lastMonthSnapshot, lastPoint, priorMonth, reconstructedMonth, transactions.length])
  const explanation = useMemo(
    () =>
      openExplain
        ? explainCategory(transactions, budget, config, asOf, openExplain.key, openExplain.month, reimbursableParentTag)
        : null,
    [openExplain, transactions, budget, config, asOf, reimbursableParentTag],
  )
  const gaps = useMemo(
    () => taggingGaps(transactions, config, reimbursableParentTag),
    [transactions, config, reimbursableParentTag],
  )
  const empty = transactions.length === 0
  const label = windowLabel(config.window, lookback.length)
  const household = result.cad.household
  const focused =
    household.calendar.find((point) => point.month === focusedMonth) ??
    household.calendar.find((point) => point.kind === 'current')
  const selectedCategory = household.categories.find((category) => category.key === openCategory) ?? null
  const usdCurrent = result.usd.household.currentMonth
  const usdPoint = result.usd.household.calendar.find((point) => point.month === focused?.month)
  const placements = focused
    ? config.knownFutures.filter(
        (future) => (future.series ?? 'household') === 'household' && monthOfKnownFuture(future, focused.month),
      )
    : []
  const monthWarnings = focused
    ? result.doubleCounts.filter((warning) => warning.month === focused.month)
    : []
  const gapsCopy = taggingGapsCopy(gaps.uncategorizedHousehold, gaps.parentOnlyReimbursable)

  const notesFor = (month: string): PlanNotesEdit => ({
    storyFor: (key) => planStory(budget, config.planHistory, config.planNotes, key, month),
    has: (key) => hasNotes(config.planNotes, key),
    onChangeNote: (row, changeMonth, draft) =>
      onConfigChange({ ...config, planNotes: withChangeNote(config.planNotes, { ...row, month: changeMonth, ...draft }) }),
    onStandingNote: (row, draft) =>
      onConfigChange({ ...config, planNotes: withStandingNote(config.planNotes, { ...row, ...draft }) }),
    ...(openPlanKey && month === currentMonth ? { openKey: openPlanKey } : {}),
    onOpened: () => setOpenPlanKey(null),
  })
  const reviews = dueReviews(config.planNotes, currentMonth)
  const changePlanFor = (review: DueReview) => {
    // Acting on it answers the review; the new change can carry its own note.
    onConfigChange({ ...config, planNotes: withReviewed(config.planNotes, review) })
    setFocusedMonth(currentMonth)
    setOpenPlanKey(review.key)
    jumpTo('forecast-compare')
  }

  const placeKnownFuture = (draft: PinRequest) => {
    if (!(draft.amount > 0) || !focused) return
    // A raise to Plan is a plan change, so the Budget tab and the dashboard
    // see it too — never a pin only this tab knows about.
    if (draft.addsTo === 'plan' && (draft.series ?? 'household') === 'household' && onPlanRaise) {
      const onward = Boolean(draft.onward && onPlanChange)
      onPlanRaise({
        key: planKey(draft.category),
        label: draft.category,
        month: focused.month,
        amount: draft.amount,
        onward,
        ...(draft.notes?.trim() || draft.reviewBy ? { note: { text: draft.notes ?? '', ...(draft.reviewBy ? { reviewBy: draft.reviewBy } : {}) } } : {}),
      })
      onNotice?.(`Raised the ${draft.category} plan for ${monthName(focused.month)}${onward ? ' on' : ' only'}.`)
      return
    }
    onConfigChange({
      ...config,
      knownFutures: [
        ...config.knownFutures,
        {
          id: uid('future'),
          category: draft.category,
          amount: draft.amount,
          month: focused.month,
          recurrence: draft.recurrence ?? 'once',
          series: draft.series ?? 'household',
          notes: draft.notes?.trim() ?? '',
          ...(draft.addsTo === 'plan' ? { addsTo: 'plan' as const } : {}),
        },
      ],
    })
    onNotice?.(`Pinned ${draft.category} on ${monthName(focused.month)}.`)
  }

  const removeKnownFuture = (id: string) => {
    onConfigChange({
      ...config,
      knownFutures: config.knownFutures.filter((future) => future.id !== id),
    })
  }

  const updateKnownFutureNotes = (id: string, notes: string) => {
    onConfigChange({
      ...config,
      knownFutures: config.knownFutures.map((future) =>
        future.id === id ? { ...future, notes: notes.trim() } : future,
      ),
    })
  }

  const showCurrentMonth = () => {
    setFocusedMonth(currentMonth)
    jumpTo('forecast-compare')
  }

  return (
    <div className="space-y-6">
      {!empty && (
        <nav
          aria-label="On this Forecast page"
          className="sticky top-14 z-[9] -mx-6 flex flex-wrap items-center gap-1 border-b border-sand-200/70 bg-sand-50/90 px-6 py-2 backdrop-blur-md"
        >
          <Jump href="#forecast-timeline">Timeline</Jump>
          <button type="button" onClick={showCurrentMonth} className="btn-quiet text-xs">
            This month
          </button>
          <Jump href="#forecast-compare">Plan vs forecast</Jump>
          <Jump href="#forecast-risk">Risk</Jump>
          {lastVariance && <Jump href="#forecast-last-month">Last month</Jump>}
          <Jump href="#forecast-categories">Categories</Jump>
          <span className="ml-auto text-[11px] uppercase tracking-wider text-ink-400">{label}</span>
        </nav>
      )}

      {!empty && reviews.length > 0 && (
        <RevisitCard
          reviews={reviews}
          currentMonth={currentMonth}
          canChange={Boolean(onPlanChange)}
          onStillRight={(review, next) =>
            onConfigChange({ ...config, planNotes: withReviewed(config.planNotes, review, next) })
          }
          onChangePlan={changePlanFor}
        />
      )}

      {!empty && gapsCopy && (
        <section className="card p-6">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Tagging still open</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">{gapsCopy}</p>
          <button onClick={onOpenTidy} className="btn-ghost mt-4 text-xs">
            Open Month end tidy
          </button>
        </section>
      )}

      {empty && (
        <section className="card p-6">
          <p className="text-sm text-ink-500">Import a Monarch export in Expenses first.</p>
        </section>
      )}

      {!empty && focused && (
        <>
          <div id="forecast-timeline" className="scroll-mt-28">
            <ForecastTimeline
              calendar={household.calendar}
              selected={focused.month}
              allowList={config.reimbursableAllowList}
              onSelect={setFocusedMonth}
            />
          </div>
          <div id="forecast-month" className="scroll-mt-28">
            <ForecastMonthCard
              {...(focused.kind === 'current'
                ? {
                    savings: {
                      income: totalIncome(inMonth(budget, focused.month)),
                      goals: budget.goals.filter((g) => g.monthly > 0).map((g) => ({ name: g.name, monthly: g.monthly })),
                    },
                  }
                : {})}
              point={focused}
              current={household.currentMonth}
              setAside={household.setAside}
              usd={
                usdPoint && (usdCurrent.actualToDate !== 0 || usdPoint.calendar !== 0)
                  ? {
                      actual: focused.kind === 'current' ? usdCurrent.actualToDate : usdPoint.actual,
                      calendar: focused.kind === 'current' ? usdCurrent.forecastEom : usdPoint.calendar,
                    }
                  : undefined
              }
              placements={placements}
              overlayBreakdown={household.overlay}
              doubleCounts={monthWarnings}
              {...(onPlanChange
                ? {
                    onPlanChange,
                    typicalPlanFor: (key: string) => planAmountAt(budget, config.planHistory, key, focused.month),
                    planNotes: notesFor(focused.month),
                  }
                : {})}
              onPlace={(row) => placeKnownFuture(row)}
              onRemove={removeKnownFuture}
              onNotesChange={updateKnownFutureNotes}
              ignoredKeys={config.ignoredCompare?.[focused.month] ?? []}
              onIgnore={(key, ignored) =>
                onConfigChange(withIgnoredCompare(config, focused.month, key, ignored))
              }
              onOpenActual={(row) => setOpenActual({ ...row, month: currentMonth })}
              onOpenForecast={(row) => setOpenExplain({ ...row, month: focused.month })}
            />
          </div>
          {explanation && openExplain && !openActual && (
            <ForecastExplainModal
              explanation={explanation}
              {...(config.categoryOverrides[explanation.key]?.type
                ? { overrideType: config.categoryOverrides[explanation.key]!.type }
                : {})}
              onChangeType={(type) => onConfigChange(withCategoryTypeOverride(config, explanation.key, type))}
              onIgnoreMonth={(month, ignored) =>
                onConfigChange(withIgnoredHistory(config, explanation.key, month, ignored))
              }
              onOpenMonth={(month) => setOpenActual({ key: explanation.key, label: explanation.label, month })}
              onClose={() => setOpenExplain(null)}
            />
          )}
          {openActual && (
            <ForecastActualModal
              category={openActual}
              month={openActual.month}
              transactions={transactions}
              config={resolvedConfig}
              reimbursableParentTag={reimbursableParentTag}
              {...(onEdit ? { onEdit } : {})}
              onClose={() => setOpenActual(null)}
            />
          )}
          {lastVariance && (
            <div id="forecast-last-month" className="scroll-mt-28">
              <ForecastMonthEnd
                variance={lastVariance}
                placeMonth={focused.month}
                {...(onPlanChange
                ? {
                    onPlanChange,
                    typicalPlanFor: (key: string) => planAmountAt(budget, config.planHistory, key, focused.month),
                  }
                : {})}
              onPlace={(row) => placeKnownFuture(row)}
              />
            </div>
          )}
          <div id="forecast-categories" className="scroll-mt-28">
            <ForecastCategories
              categories={household.categories}
              selected={selectedCategory}
              focusedMonth={focused.month}
              doubleCounts={result.doubleCounts}
              onSelect={setOpenCategory}
              onPin={(draft) => {
                placeKnownFuture(draft)
                setOpenCategory(null)
              }}
              overrideType={
                selectedCategory ? config.categoryOverrides[selectedCategory.key]?.type : undefined
              }
              onOverrideType={(key, type) => onConfigChange(withCategoryTypeOverride(config, key, type))}
              onOverrideMonths={(key, months) =>
                onConfigChange(withCategoryTypicalMonths(config, key, months))
              }
            />
          </div>
          <ForecastVacationCard vacation={result.cad.vacation} goal={result.vacationGoal} />
          <ForecastGoals
            coverage={result.coverage}
            goals={budget.goals}
            vacationGoal={result.vacationGoal}
            onApplyContribution={
              onApplyHouseholdContribution
                ? (monthly, vacationGoalId) => {
                    onApplyHouseholdContribution(monthly, vacationGoalId)
                    onNotice?.(`Household contribution is now ${amountIn(monthly, 'CAD')} a month.`)
                  }
                : undefined
            }
          />
        </>
      )}
    </div>
  )
}

function Jump({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} className="btn-quiet text-xs">
      {children}
    </a>
  )
}

function jumpTo(id: string) {
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 50)
}

function oldestDate(transactions: Transaction[]): string {
  let min = transactions[0]!.date
  for (const transaction of transactions) {
    if (transaction.date < min) min = transaction.date
  }
  return min
}

/** Notes whose review month has arrived: confirm them or change the plan. */
function RevisitCard({
  reviews,
  currentMonth,
  canChange,
  onStillRight,
  onChangePlan,
}: {
  reviews: DueReview[]
  currentMonth: string
  canChange: boolean
  onStillRight: (review: DueReview, next?: string) => void
  onChangePlan: (review: DueReview) => void
}) {
  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Assumptions to revisit</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        Notes you asked to look at again by now. If the assumption still holds, say when to look next (or never);
        otherwise change the plan.
      </p>
      <ul className="mt-4 space-y-2">
        {reviews.map((review) => (
          <RevisitLine
            key={`${review.key}|${review.month ?? 'standing'}`}
            review={review}
            currentMonth={currentMonth}
            canChange={canChange}
            onStillRight={onStillRight}
            onChangePlan={onChangePlan}
          />
        ))}
      </ul>
    </section>
  )
}

function RevisitLine({
  review,
  currentMonth,
  canChange,
  onStillRight,
  onChangePlan,
}: {
  review: DueReview
  currentMonth: string
  canChange: boolean
  onStillRight: (review: DueReview, next?: string) => void
  onChangePlan: (review: DueReview) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [next, setNext] = useState('')
  return (
    <li className="rounded-2xl bg-white/70 px-4 py-3 text-sm">
      <p className="font-medium text-ink-900">
        {review.label}
        <span className="font-normal text-ink-400">
          {' '}
          · {review.month ? `plan change ${monthName(review.month)}` : 'category note'} · review by{' '}
          {monthName(review.note.reviewBy!)}
        </span>
      </p>
      <p className="mt-0.5 text-ink-700">{review.note.text || 'No note text.'}</p>
      {confirming ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-500">
            Next review <span className="text-ink-400">(leave empty for none)</span>
            <input
              type="month"
              className="field mt-1 block py-1.5 text-sm"
              min={currentMonth}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => onStillRight(review, next > currentMonth ? next : undefined)}
          >
            Confirm
          </button>
          <button type="button" className="btn-quiet text-xs" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => setConfirming(true)}>
            Still right
          </button>
          {canChange && (
            <button type="button" className="btn-ghost text-xs" onClick={() => onChangePlan(review)}>
              Change plan
            </button>
          )}
        </div>
      )}
    </li>
  )
}
