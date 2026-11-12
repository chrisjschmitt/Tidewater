import { useEffect, useMemo, useRef, useState } from 'react'
import ForecastActualModal from './ForecastActualModal'
import ForecastExplainModal from './ForecastExplainModal'
import ForecastMonthCard from './ForecastMonthCard'
import ForecastTimeline from './ForecastTimeline'
import ForecastMonthStrip from './ForecastMonthStrip'
import TravelSavingCard from './TravelSavingCard'
import { monthName, today } from '../../lib/etm/period'
import { uid } from '../../lib/format'
import { inMonth, totalIncome } from '../../lib/budget'
import { explainCategory, forecast, lookbackMonths, monthOfKnownFuture, windowLabel } from '../../lib/forecast/forecast'
import { snapshotFromResult } from '../../lib/forecast/snapshot'
import { travelOutlook } from '../../lib/forecast/travel'
import { withForecastDefaults, type ForecastConfig, type ForecastSnapshot, type PinRequest } from '../../lib/forecast/types'
import {
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
  withChangeNote,
  withReviewed,
  withStandingNote,
  type DueReview,
  type PlanChangeRequest,
  type PlanNoteDraft,
} from '../../lib/forecast/planNotes'
import CategoryPlanModal, { isTyping } from './CategoryPlanModal'

interface Props {
  transactions: Transaction[]
  budget: Budget
  config: ForecastConfig
  reimbursableParentTag: string
  onConfigChange: (config: ForecastConfig) => void
  onSnapshot: (snapshot: ForecastSnapshot) => void
  onNotice?: (message: string) => void
  /** Changes a category's plan from a month on (planHistory.ts). */
  onPlanChange?: (change: PlanChangeRequest) => void
  /** Sets a category's plan for one month only; the months around it keep theirs. */
  onPlanForMonth?: (change: PlanChangeRequest) => void
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
  onConfigChange,
  onSnapshot,
  onNotice,
  onPlanChange,
  onPlanForMonth,
  onPlanRaise,
  onEdit,
}: Props) {
  const asOf = today()
  const currentMonth = asOf.slice(0, 7)
  const [focusedMonth, setFocusedMonth] = useState(currentMonth)
  const [openActual, setOpenActual] = useState<{ key: string; label: string; month: string } | null>(null)
  const [openExplain, setOpenExplain] = useState<{ key: string; label: string; month: string } | null>(null)
  // The category open month by month (CategoryPlanModal).
  const [openPlan, setOpenPlan] = useState<{ key: string; label: string; month: string; showTransactions?: boolean } | null>(
    null,
  )
  // Whether the full timeline is on screen; when it isn't, the sticky bar
  // carries a slim month strip instead.
  const [timelineInView, setTimelineInView] = useState(true)
  // The page's own sticky bar: its height lets table headings stick just below it.
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = rootRef.current
    const bar = barRef.current
    if (!root || !bar || typeof ResizeObserver === 'undefined') return
    const update = () => root.style.setProperty('--forecast-bar', `${bar.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    return () => observer.disconnect()
  })
  useEffect(() => {
    const target = document.getElementById('forecast-timeline')
    if (!target || typeof IntersectionObserver === 'undefined') return
    // The sticky header and this page's bar cover the top of the screen.
    const covered = (document.querySelector('[style*="--etm-header"]') as HTMLElement | null)?.style.getPropertyValue('--etm-header')
    const observer = new IntersectionObserver(
      ([entry]) => setTimelineInView(Boolean(entry?.isIntersecting)),
      { rootMargin: `-${(Number.parseInt(covered ?? '', 10) || 56) + 80}px 0px 0px 0px` },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [transactions.length === 0])
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
  const explanation = useMemo(
    () =>
      openExplain
        ? explainCategory(transactions, budget, config, asOf, openExplain.key, openExplain.month, reimbursableParentTag)
        : null,
    [openExplain, transactions, budget, config, asOf, reimbursableParentTag],
  )
  const empty = transactions.length === 0
  const label = windowLabel(config.window, lookback.length)
  const household = result.cad.household
  const focused =
    household.calendar.find((point) => point.month === focusedMonth) ??
    household.calendar.find((point) => point.kind === 'current')
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

  // ← → step the page a month, when no window is open and no field is in use.
  const calendarMonths = household.calendar.map((point) => point.month)
  const windowOpen = Boolean(openPlan || openActual || openExplain)
  useEffect(() => {
    if (windowOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (isTyping(event.target) || event.metaKey || event.altKey || event.ctrlKey) return
      const at = calendarMonths.indexOf(focused?.month ?? currentMonth)
      const next = calendarMonths[at + (event.key === 'ArrowLeft' ? -1 : 1)]
      if (!next) return
      event.preventDefault()
      setFocusedMonth(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const reviews = dueReviews(config.planNotes, currentMonth)
  const changePlanFor = (review: DueReview) => {
    // Acting on it answers the review; the new change can carry its own note.
    onConfigChange({ ...config, planNotes: withReviewed(config.planNotes, review) })
    setOpenPlan({ key: review.key, label: review.label, month: currentMonth })
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
    <div ref={rootRef} className="space-y-6">
      {!empty && (
        <nav
          ref={barRef}
          aria-label="On this Forecast page"
          className="sticky z-[9] -mx-6 flex flex-wrap items-center gap-1 border-b border-sand-200/70 bg-sand-50/90 px-6 py-2 backdrop-blur-md"
          style={{ top: 'var(--etm-header, 3.5rem)' }}
        >
          <Jump href="#forecast-timeline">Timeline</Jump>
          <button type="button" onClick={showCurrentMonth} className="btn-quiet text-xs">
            This month
          </button>
          <Jump href="#forecast-compare">Plan vs forecast</Jump>
          <Jump href="#forecast-risk">Risk</Jump>
          <span className="ml-auto text-[11px] uppercase tracking-wider text-ink-400">{label}</span>
          {focused && (
            <div className="mt-1 w-full border-t border-sand-200/70 pt-2">
              <ForecastMonthStrip
                calendar={household.calendar}
                selected={focused.month}
                currentMonth={currentMonth}
                showStrip={!timelineInView}
                onSelect={setFocusedMonth}
              />
            </div>
          )}
        </nav>
      )}

      {!empty && (
        <TravelSavingCard
          months={travelOutlook(
            household.calendar,
            household.currentMonth,
            budget,
            result.vacationGoal.status === 'matched' ? result.vacationGoal.monthly : 0,
            config.ignoredCompare ?? {},
          )}
          {...(result.vacationGoal.status === 'matched' && result.vacationGoal.goalName
            ? { goalName: result.vacationGoal.goalName, goalId: result.vacationGoal.goalId }
            : {})}
          goals={budget.goals.map((goal) => ({ id: goal.id, name: goal.name, monthly: goal.monthly }))}
          onChooseGoal={(goalId) => onConfigChange({ ...config, vacationGoalId: goalId })}
          onSelect={(month) => {
            setFocusedMonth(month)
            jumpTo('forecast-month')
          }}
        />
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


      {empty && (
        <section className="card p-6">
          <p className="text-sm text-ink-500">Bring in your TD transactions first (Weekly check-in).</p>
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
                    onOpenPlan: (row: { key: string; label: string }) => setOpenPlan({ ...row, month: focused.month }),
                    hasPlanNotes: (key: string) => hasNotes(config.planNotes, key),
                  }
                : {})}
              onPlace={(row) => placeKnownFuture(row)}
              onRemove={removeKnownFuture}
              onNotesChange={updateKnownFutureNotes}
              ignoredKeys={config.ignoredCompare?.[focused.month] ?? []}
              onIgnore={(key, ignored) =>
                onConfigChange(withIgnoredCompare(config, focused.month, key, ignored))
              }
              onOpenActual={(row) => setOpenPlan({ ...row, month: focused.month, showTransactions: true })}
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
          {openPlan && !openActual && (
            <CategoryPlanModal
              key={openPlan.key}
              category={openPlan}
              initialMonth={openPlan.month}
              currentMonth={currentMonth}
              calendar={household.calendar}
              budget={budget}
              config={config}
              resolvedConfig={resolvedConfig}
              transactions={transactions}
              reimbursableParentTag={reimbursableParentTag}
              {...(openPlan.showTransactions ? { showTransactions: true } : {})}
              {...(onPlanChange ? { onPlanChange } : {})}
              {...(onPlanForMonth ? { onPlanForMonth } : {})}
              onChangeNote={(month, draft) =>
                onConfigChange({
                  ...config,
                  planNotes: withChangeNote(config.planNotes, { key: openPlan.key, label: openPlan.label, month, ...draft }),
                })
              }
              onStandingNote={(draft) =>
                onConfigChange({
                  ...config,
                  planNotes: withStandingNote(config.planNotes, { key: openPlan.key, label: openPlan.label, ...draft }),
                })
              }
              {...(onEdit ? { onEdit } : {})}
              onClose={() => setOpenPlan(null)}
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
