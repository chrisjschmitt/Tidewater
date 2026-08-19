import { useMemo, useState } from 'react'
import ForecastCategories from './ForecastCategories'
import ForecastMonthCard from './ForecastMonthCard'
import ForecastTimeline from './ForecastTimeline'
import ForecastVacationCard from './ForecastVacationCard'
import {
  excludedOutliersCopy,
  taggingGapsCopy,
  windowDisagreementCopy,
} from './forecastCopy'
import { amountIn } from '../../lib/etm/format'
import { monthName, today } from '../../lib/etm/period'
import { uid } from '../../lib/format'
import { CONTROL_WINDOW, forecast, lookbackMonths, monthOfKnownFuture, windowLabel } from '../../lib/forecast/forecast'
import type { ForecastConfig, ForecastWindow, KnownFuture, SeriesId } from '../../lib/forecast/types'
import {
  appearedSubtags,
  completeSubtag,
  householdTagOptions,
  tagSelected,
  taggingGaps,
  vacationTagOptions,
  withAllowListedTag,
  withVacationTag,
} from '../../lib/forecast/universe'
import type { Transaction } from '../../lib/etm/types'
import type { Budget } from '../../lib/types'

interface Props {
  transactions: Transaction[]
  budget: Budget
  config: ForecastConfig
  reimbursableParentTag: string
  onConfigChange: (config: ForecastConfig) => void
  onOpenTidy: () => void
}

const WINDOWS: Array<[ForecastWindow, string]> = [
  [12, '12 months'],
  [24, '24 months'],
  ['all', 'All time'],
]

const OUTLIERS: Array<[0 | 1 | 2, string]> = [
  [0, 'With every irregular'],
  [1, 'Without the largest'],
  [2, 'Without the two largest'],
]

export default function ForecastPanel({
  transactions,
  budget,
  config,
  reimbursableParentTag,
  onConfigChange,
  onOpenTidy,
}: Props) {
  const asOf = today()
  const [focusedMonth, setFocusedMonth] = useState(asOf.slice(0, 7))
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const appeared = useMemo(
    () => appearedSubtags(transactions, reimbursableParentTag),
    [transactions, reimbursableParentTag],
  )
  const householdOptions = useMemo(
    () => householdTagOptions(appeared, config.reimbursableAllowList, config.vacationTags),
    [appeared, config.reimbursableAllowList, config.vacationTags],
  )
  const vacationOptions = useMemo(
    () => vacationTagOptions(appeared, config.vacationTags),
    [appeared, config.vacationTags],
  )
  const lookback = useMemo(
    () => lookbackMonths(asOf, config.window, transactions.length ? oldestDate(transactions) : undefined),
    [asOf, config.window, transactions],
  )
  const result = useMemo(
    () => forecast(transactions, budget, config, asOf, reimbursableParentTag),
    [transactions, budget, config, asOf, reimbursableParentTag],
  )
  const compareWindow: ForecastWindow = config.window === 24 ? 12 : 24
  const compared = useMemo(
    () =>
      transactions.length === 0
        ? null
        : forecast(transactions, budget, { ...config, window: compareWindow }, asOf, reimbursableParentTag),
    [transactions, budget, config, compareWindow, asOf, reimbursableParentTag],
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
  const disagreement = compared && windowDisagrees(household.setAside.likely, compared.cad.household.setAside.likely, config.window, compareWindow)
  const outlierNote = excludedOutliersCopy(
    household.overlay.excludedOutliers.map((item) => ({
      label: household.categories.find((category) => category.key === item.key)?.label ?? item.key,
      month: monthName(item.month),
      amount: amountIn(item.amount, 'CAD'),
    })),
  )
  const gapsCopy = taggingGapsCopy(gaps.uncategorizedHousehold, gaps.parentOnlyReimbursable)

  const placeKnownFuture = (draft: {
    category: string
    amount: number
    recurrence?: KnownFuture['recurrence']
    series?: SeriesId
  }) => {
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
          notes: '',
        },
      ],
    })
  }

  const removeKnownFuture = (id: string) => {
    onConfigChange({
      ...config,
      knownFutures: config.knownFutures.filter((future) => future.id !== id),
    })
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-5">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Forecast</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            A look at what typically lands, and when. Nothing here rewrites your monthly plan —
            it is a second reading of the same expenses.
          </p>
        </header>

        <p className="mb-4 text-[11px] uppercase tracking-wider text-ink-400">
          {empty ? `${config.window === 'all' ? 'All-time' : `${config.window}-month`} window` : label}
        </p>

        <div className="flex flex-wrap gap-1">
          {WINDOWS.map(([id, name]) => (
            <button
              key={String(id)}
              onClick={() => onConfigChange({ ...config, window: id })}
              className={
                config.window === id
                  ? 'rounded-full bg-tide-600 px-3.5 py-1.5 text-xs font-medium text-white'
                  : 'btn-quiet text-xs'
              }
            >
              {name}
            </button>
          ))}
        </div>

        {config.window !== 'all' && lookback.length > 0 && lookback.length < config.window && (
          <p className="mt-3 text-sm text-ink-500">
            {lookback.length} months of history, not {config.window}. The numbers will name this
            window until more months are in.
          </p>
        )}

        {disagreement && compared && (
          <p className="mt-3 max-w-prose text-sm text-ink-500">
            {windowDisagreementCopy(
              { window: config.window, likely: amountIn(household.setAside.likely, 'CAD') },
              { window: compareWindow, likely: amountIn(compared.cad.household.setAside.likely, 'CAD') },
            )}
          </p>
        )}

        <p className="mt-5 text-[11px] uppercase tracking-wider text-ink-400">Largest irregular items</p>
        <p className="mt-1 max-w-prose text-sm text-ink-500">
          Default is with every irregular that happened — the honest reading. Leaving the largest
          out is a sensitivity check, not a claim that the cost never occurs.
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {OUTLIERS.map(([count, name]) => (
            <button
              key={count}
              onClick={() => onConfigChange({ ...config, excludeTopOutliers: count })}
              className={
                config.excludeTopOutliers === count
                  ? 'rounded-full bg-tide-600 px-3.5 py-1.5 text-xs font-medium text-white'
                  : 'btn-quiet text-xs'
              }
            >
              {name}
            </button>
          ))}
        </div>
        {outlierNote && <p className="mt-3 text-sm text-ink-500">{outlierNote}</p>}
      </section>

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
            doubleCounts={monthWarnings}
            onPlace={(row) => placeKnownFuture(row)}
            onRemove={removeKnownFuture}
          />
          <ForecastTimeline
            calendar={household.calendar}
            selected={focused.month}
            onSelect={setFocusedMonth}
          />
          <ForecastVacationCard vacation={result.cad.vacation} goal={result.vacationGoal} />
          <ForecastCategories
            categories={household.categories}
            selected={selectedCategory}
            focusedMonth={focused.month}
            doubleCounts={result.doubleCounts}
            onSelect={setOpenCategory}
            onPin={(draft) => placeKnownFuture(draft)}
          />
        </>
      )}

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">What counts as household</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          The Budget tab still holds every reimbursable-tagged row out of family-budget actuals.
          Forecasting is different on purpose: allow-listed sub-tags (healthcare, capital, annual
          fees) are household cash you still need on hand. Vacation is its own series, never mixed
          in. Everything else reimbursable stays out of both.
        </p>

        <TagChecklist
          options={householdOptions}
          selected={config.reimbursableAllowList}
          parent={reimbursableParentTag}
          addLabel="Add a household sub-tag"
          onToggle={(tag, included) =>
            onConfigChange(withAllowListedTag(config, tag, included, reimbursableParentTag))
          }
        />
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Vacation series</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          Travel is paid from the vacation pot, not from the monthly household plan. Tags checked
          here are forecast on their own card and never added into household totals.
        </p>

        <TagChecklist
          options={vacationOptions}
          selected={config.vacationTags}
          parent={reimbursableParentTag}
          addLabel="Add a vacation tag"
          onToggle={(tag, included) =>
            onConfigChange(withVacationTag(config, tag, included, reimbursableParentTag))
          }
        />
      </section>
    </div>
  )
}

function windowDisagrees(
  selectedLikely: number,
  otherLikely: number,
  selectedWindow: ForecastWindow,
  otherWindow: ForecastWindow,
): boolean {
  const twelve =
    selectedWindow === 12 ? selectedLikely : otherWindow === 12 ? otherLikely : selectedLikely
  const denom = selectedWindow === 12 || otherWindow === 12 ? twelve : otherLikely
  if (denom <= 0) return selectedLikely !== otherLikely && (selectedLikely > 0 || otherLikely > 0)
  return Math.abs(selectedLikely - otherLikely) / denom > CONTROL_WINDOW
}

function oldestDate(transactions: Transaction[]): string {
  let min = transactions[0]!.date
  for (const transaction of transactions) {
    if (transaction.date < min) min = transaction.date
  }
  return min
}

function TagChecklist({
  options,
  selected,
  parent,
  addLabel,
  onToggle,
}: {
  options: string[]
  selected: string[]
  parent: string
  addLabel: string
  onToggle: (tag: string, included: boolean) => void
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const tag = completeSubtag(draft, parent)
    if (!tag) return
    onToggle(tag, true)
    setDraft('')
  }

  return (
    <div className="mt-4 space-y-1">
      {options.map((tag) => {
        const checked = tagSelected(selected, tag)
        return (
          <label
            key={tag}
            className="flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/70"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => onToggle(tag, event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-tide-600"
            />
            <span className="min-w-0 text-sm text-ink-900">{tag}</span>
          </label>
        )
      })}

      <div className="flex flex-wrap items-center gap-2 pt-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
          placeholder={addLabel}
          className="field max-w-md text-sm"
        />
        <button onClick={add} className="btn-ghost text-xs" disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
