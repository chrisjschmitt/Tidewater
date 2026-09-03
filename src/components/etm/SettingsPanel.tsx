import { useMemo, useState } from 'react'
import {
  excludedOutliersCopy,
  windowDisagreementCopy,
} from './forecastCopy'
import { amountIn } from '../../lib/etm/format'
import { monthName, today } from '../../lib/etm/period'
import { CONTROL_WINDOW, forecast, lookbackMonths, windowLabel } from '../../lib/forecast/forecast'
import type { ForecastConfig, ForecastWindow } from '../../lib/forecast/types'
import {
  appearedSubtags,
  completeSubtag,
  householdTagOptions,
  tagSelected,
  vacationTagOptions,
  withAllowListedTag,
  withVacationTag,
} from '../../lib/forecast/universe'
import type { Transaction } from '../../lib/etm/types'
import type { Budget } from '../../lib/types'
import { WATCH_FOLDER_INPUT_ID } from './useWatchFolder'

interface WatchProps {
  supported: boolean
  folderName?: string
  csvCount?: number
  newestName?: string
  notice?: string
  onForget: () => Promise<void>
}

interface Props {
  transactions: Transaction[]
  budget: Budget
  config: ForecastConfig
  reimbursableParentTag: string
  onConfigChange: (config: ForecastConfig) => void
  onWipe: () => void
  watch: WatchProps
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

export default function SettingsPanel({
  transactions,
  budget,
  config,
  reimbursableParentTag,
  onConfigChange,
  onWipe,
  watch,
}: Props) {
  const asOf = today()
  const [confirmingWipe, setConfirmingWipe] = useState(false)

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
    () =>
      transactions.length === 0 ? null : forecast(transactions, budget, config, asOf, reimbursableParentTag),
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
  const household = result?.cad.household
  const disagreement =
    household &&
    compared &&
    windowDisagrees(household.setAside.likely, compared.cad.household.setAside.likely, config.window, compareWindow)
  const outlierNote = household
    ? excludedOutliersCopy(
        household.overlay.excludedOutliers.map((item) => ({
          label: household.categories.find((category) => category.key === item.key)?.label ?? item.key,
          month: monthName(item.month),
          amount: amountIn(item.amount, 'CAD'),
        })),
      )
    : null
  const label = windowLabel(config.window, lookback.length)

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-5">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Forecast</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            How far back the Forecast tab looks, and whether the largest irregular items are left
            out of that reading. Nothing here rewrites your monthly plan.
          </p>
        </header>

        <p className="mb-4 text-[11px] uppercase tracking-wider text-ink-400">
          {transactions.length === 0
            ? `${config.window === 'all' ? 'All-time' : `${config.window}-month`} window`
            : label}
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

        {disagreement && household && compared && (
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

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">What counts as household</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          The Budget tab holds every row in the reimbursable family out of family-budget actuals —
          the generic prefix or any `Reimbursable: …` sub-tag. Forecasting is different on purpose:
          allow-listed sub-tags (healthcare, capital, annual fees) are household cash you still need
          on hand. Vacation is its own series, never mixed in. Everything else reimbursable stays
          out of both.
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

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">
          Watch this folder for Monarch exports
        </h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          {watch.supported
            ? 'Pick the folder you already drop CSVs into. After Open, you should see that folder’s name and how many CSV files are in it — not a full disk path. A newer file is offered for Import review. Nothing is written until you bring it in. After the next unlock, choose the same folder again to check.'
            : 'This device cannot list the files in a folder. Use Choose a CSV on the Import tab — that is the same review, one file at a time.'}
        </p>
        {watch.supported ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label
                htmlFor={WATCH_FOLDER_INPUT_ID}
                className="btn-primary cursor-pointer text-xs"
              >
                {watch.folderName ? 'Choose a different folder' : 'Choose a folder'}
              </label>
              {watch.folderName && (
                <button onClick={() => void watch.onForget()} className="btn-ghost text-xs">
                  Forget this folder
                </button>
              )}
            </div>
            {watch.folderName && (
              <div className="mt-4 rounded-2xl bg-white/70 px-4 py-3.5">
                <p className="text-sm font-medium text-ink-900">Watching “{watch.folderName}”</p>
                <p className="mt-1 text-sm text-ink-500">
                  {watch.csvCount === undefined
                    ? 'Choose that folder again to list its CSV files.'
                    : watch.csvCount === 0
                      ? 'No CSV files in that folder yet.'
                      : watch.newestName
                        ? `${watch.csvCount} CSV file${watch.csvCount === 1 ? '' : 's'}. Newest is ${watch.newestName}.`
                        : `${watch.csvCount} CSV file${watch.csvCount === 1 ? '' : 's'}.`}
                </p>
              </div>
            )}
            {watch.notice && <p className="mt-3 text-sm text-shell-500">{watch.notice}</p>}
          </>
        ) : null}
      </section>

      <section className="max-w-xl rounded-2xl border border-shell-300/50 bg-shell-300/10 px-4 py-3.5">
        <p className="text-sm font-medium text-ink-900">Erase expense data</p>
        <p className="mt-0.5 text-xs text-ink-500">
          Removes this device’s encrypted expense store, the key setup, and any remembered
          export folder. Your budget, goals, and profile are untouched, and everything here can
          be imported again from Monarch.
        </p>
        {confirmingWipe ? (
          <div className="mt-3 flex gap-2">
            <button onClick={onWipe} className="btn bg-shell-500 text-white hover:opacity-90">
              Yes, erase it
            </button>
            <button onClick={() => setConfirmingWipe(false)} className="btn-ghost">
              Keep it
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmingWipe(true)} className="btn-ghost mt-3">
            Erase expense data
          </button>
        )}
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
