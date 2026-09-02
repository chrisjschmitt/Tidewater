import { useEffect, useMemo, useState } from 'react'
import ForecastCategories from './ForecastCategories'
import ForecastGoals from './ForecastGoals'
import ForecastMonthCard from './ForecastMonthCard'
import ForecastMonthEnd from './ForecastMonthEnd'
import ForecastTimeline from './ForecastTimeline'
import ForecastVacationCard from './ForecastVacationCard'
import { taggingGapsCopy } from './forecastCopy'
import { amountIn } from '../../lib/etm/format'
import { monthName, today } from '../../lib/etm/period'
import { uid } from '../../lib/format'
import { walkForward } from '../../lib/forecast/backtest'
import { forecast, lookbackMonths, monthOfKnownFuture, windowLabel } from '../../lib/forecast/forecast'
import { lastFullMonth, monthEndVariance, snapshotFromResult } from '../../lib/forecast/snapshot'
import type { ForecastConfig, ForecastSnapshot, PinRequest } from '../../lib/forecast/types'
import { taggingGaps, withCategoryTypicalMonths, withCategoryTypeOverride, withIgnoredCompare } from '../../lib/forecast/universe'
import type { Transaction } from '../../lib/etm/types'
import type { Budget } from '../../lib/types'

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
}: Props) {
  const asOf = today()
  const currentMonth = asOf.slice(0, 7)
  const [focusedMonth, setFocusedMonth] = useState(currentMonth)
  const [openCategory, setOpenCategory] = useState<string | null>(null)

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

  const placeKnownFuture = (draft: PinRequest) => {
    if (!(draft.amount > 0) || !focused) return
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
    jumpTo('forecast-this-month')
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
              onPlace={(row) => placeKnownFuture(row)}
              onRemove={removeKnownFuture}
              onNotesChange={updateKnownFutureNotes}
              ignoredKeys={config.ignoredCompare?.[focused.month] ?? []}
              onIgnore={(key, ignored) =>
                onConfigChange(withIgnoredCompare(config, focused.month, key, ignored))
              }
            />
          </div>
          {lastVariance && (
            <div id="forecast-last-month" className="scroll-mt-28">
              <ForecastMonthEnd
                variance={lastVariance}
                placeMonth={focused.month}
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
