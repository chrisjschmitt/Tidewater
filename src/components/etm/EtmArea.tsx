import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AccountsPanel from './AccountsPanel'
import BudgetPanel from './BudgetPanel'
import ForecastPanel from './ForecastPanel'
import ImportPanel from './ImportPanel'
import TdStatementsCard from './TdStatementsCard'
import RulesCompareCard from './RulesCompareCard'
import RulesSettingsCard from './RulesSettingsCard'
import ReviewPanel from './ReviewPanel'
import DuplicatesCard from './DuplicatesCard'
import TransactionEditor from './TransactionEditor'
import Modal from '../Modal'
import SwitchOverCard from './SwitchOverCard'
import BackupCard from './BackupCard'
import KeyCard from './KeyCard'
import { useSafeguards } from './useSafeguards'
import PeriodSelector from './PeriodSelector'
import ReimbursableSettingsCard from './ReimbursableSettingsCard'
import SettingsPanel from './SettingsPanel'
import WorkflowPanel from './WorkflowPanel'
import TransactionsPanel from './TransactionsPanel'
import FeedCompareCard from './FeedCompareCard'
import { useWatchFolder, WATCH_FOLDER_INPUT_ID } from './useWatchFolder'
import type { EtmData } from './useEtmData'
import { monthKeys, monthPeriod, today, type Period } from '../../lib/etm/period'
import { countingFrom, type CountingFrom } from '../../lib/etm/ledger'
import { readWeeklyDone, weeklySteps, writeWeeklyDone } from '../../lib/etm/routine'
import { findPossibleDuplicates } from '../../lib/etm/duplicates'
import WeeklyCheckIn from './WeeklyCheckIn'
import {
  budgetAt,
  budgetOver,
  planAmountAt,
  withPlanChange,
  withPlanForMonth,
  withPlanPinsAsPlans,
} from '../../lib/forecast/planHistory'
import {
  withChangeNote,
  withoutNotesAfter,
  type PlanChangeRequest,
  type PlanNoteDraft,
  type PlanNotes,
} from '../../lib/forecast/planNotes'
import type { Budget } from '../../lib/types'
import FreshnessBar from './FreshnessBar'
import { digest, noteData, readFreshness, writeFreshness, type Freshness } from '../../lib/etm/freshness'

interface Props {
  data: EtmData
  budget: Budget
  period: Period
  onPeriodChange: (period: Period) => void
  onClose: () => void
  onLock: () => void
  onWipe: () => void
  onOpenChat: () => void
  onApplyHouseholdContribution?: (monthly: number, vacationGoalId?: string) => void
  /** Replaces the budget's expense lines — the plan going forward. */
  onExpensesChange?: (expenses: Budget['expenses']) => void
  onRestoreBackup?: (file: File) => void
  /** The session's key, for re-encrypting under a new one. */
  unlockedKey: CryptoKey
  onKeyChanged: (key: CryptoKey) => void
}

type Tab = 'overview' | 'weekly' | 'month' | 'budget' | 'transactions' | 'settings'

/** Overview first; then the two routines; then the views for looking things up. */
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['weekly', 'Weekly check-in'],
  ['month', 'Month end'],
  ['budget', 'Budget'],
  ['transactions', 'Transactions'],
  ['settings', 'Settings'],
]

/** The period selector is hidden on tabs it does not govern. */
const PERIODIC: Tab[] = ['budget', 'transactions']

export default function EtmArea({
  data,
  budget,
  period,
  onPeriodChange,
  onClose,
  onLock,
  onWipe,
  onOpenChat,
  onExpensesChange,
  onRestoreBackup,
  unlockedKey,
  onKeyChanged,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  // The header wraps to two lines on narrower screens (the iPad); bars that
  // stick below it read its height from --etm-header.
  const areaRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const header = headerRef.current
    const area = areaRef.current
    if (!header || !area || typeof ResizeObserver === 'undefined') return
    const update = () => area.style.setProperty('--etm-header', `${header.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const safeguards = useSafeguards(budget)
  // After an import or a review session, back up to the chosen folder — a
  // little later, so a run of edits makes one backup, not one each.
  const batchSignature = data.batches.map((b) => `${b.id}:${b.importedAt}:${b.rowsRead}`).join('|')
  const lastSignature = useRef<string | null>(null)
  const { autoBackUpNow } = safeguards
  useEffect(() => {
    if (data.loading) return
    if (lastSignature.current === null) {
      lastSignature.current = batchSignature
      return
    }
    if (lastSignature.current === batchSignature) return
    lastSignature.current = batchSignature
    const timer = window.setTimeout(() => void autoBackUpNow(), 15_000)
    return () => window.clearTimeout(timer)
  }, [batchSignature, data.loading, autoBackUpNow])
  // How fresh this device's data is: a digest of everything a backup holds
  // (transactions, settings, the plan). A new digest means it changed here.
  const freshnessInput = useMemo(() => {
    if (data.loading) return undefined
    const rows = data.allRows
    const latest = (source: string) =>
      rows.reduce<string | undefined>((max, t) => (t.source === source && (!max || t.date > max) ? t.date : max), undefined)
    const signature = digest(
      JSON.stringify([
        rows.map((t) => [t.id, t.date, t.amount, t.category, t.tags, t.notes, t.reviewed, t.split, t.duplicateOf, t.budgetDate]),
        data.accounts,
        data.config,
        data.forecastConfig,
        [budget.income, budget.expenses, budget.goals],
      ]),
    )
    // Before this device kept a record, its last import is the best guess at
    // when its data last changed — not the moment it was first opened.
    const lastImport = data.batches.reduce<string | undefined>(
      (max, b) => (!max || b.importedAt > max ? b.importedAt : max),
      undefined,
    )
    return { signature, tdThrough: latest('td'), monarchThrough: latest('monarch'), lastImport }
  }, [data.loading, data.batches, data.allRows, data.accounts, data.config, data.forecastConfig, budget.income, budget.expenses, budget.goals])
  const [freshness, setFreshness] = useState<Freshness | undefined>(() => readFreshness())
  useEffect(() => {
    if (!freshnessInput) return
    const next = noteData(
      {
        signature: freshnessInput.signature,
        ...(freshnessInput.tdThrough ? { tdThrough: freshnessInput.tdThrough } : {}),
        ...(freshnessInput.monarchThrough ? { monarchThrough: freshnessInput.monarchThrough } : {}),
      },
      readFreshness(),
      ...(readFreshness() ? [] : [freshnessInput.lastImport]),
    )
    writeFreshness(next)
    setFreshness(next)
  }, [freshnessInput])

  // Where the weekly check-in stands — its steps and the tab's badge.
  const [weeklyDone, setWeeklyDone] = useState<string | undefined>(() => readWeeklyDone())
  const duplicateCount = useMemo(() => {
    const counting = new Set(data.transactions.map((row) => row.splitOf?.parentId ?? row.id))
    return findPossibleDuplicates(data.allRows, data.rules.settings.notDuplicates, counting).length
  }, [data.allRows, data.transactions, data.rules.settings.notDuplicates])
  const weekly = useMemo(
    () =>
      weeklySteps({
        today: today(),
        ...(weeklyDone ? { lastDone: weeklyDone } : {}),
        batches: data.batches,
        ...(data.config.pending ? { pendingDate: data.config.pending.date } : {}),
        tdRows: data.allRows.filter((row) => row.source === 'td' && !row.duplicateOf),
        duplicates: duplicateCount,
        ...(safeguards.lastBackup ? { lastBackup: safeguards.lastBackup } : {}),
        ...(freshness?.changedAt ? { changedAt: freshness.changedAt } : {}),
      }),
    [weeklyDone, data.batches, data.config.pending, data.allRows, duplicateCount, safeguards.lastBackup, freshness?.changedAt],
  )

  // The travel goal (chosen on Overview, or named with vacation/travel), for the month-end transfer.
  const travelGoal = useMemo(() => {
    const chosen = data.forecastConfig.vacationGoalId
    const goal = chosen
      ? budget.goals.find((g) => g.id === chosen)
      : (() => {
          const named = budget.goals.filter((g) => /vacation|travel/i.test(g.name))
          return named.length === 1 ? named[0] : undefined
        })()
    return goal ? { name: goal.name, monthly: goal.monthly } : undefined
  }, [budget.goals, data.forecastConfig.vacationGoalId])

  // Plan-only pins from before 0.13.12 become plan changes for their month,
  // once, so every Plan figure agrees.
  const pinsMoved = useRef(false)
  useEffect(() => {
    if (pinsMoved.current) return
    const moved = withPlanPinsAsPlans(budget, data.forecastConfig)
    if (!moved) return
    pinsMoved.current = true
    void data.saveForecastSettings(moved)
  }, [budget, data.forecastConfig, data.saveForecastSettings])
  const counting = useMemo(
    () => countingFrom(data.config.tdCutover, data.allRows.filter((r) => r.source === 'td').map((r) => r.accountId), today()),
    [data.allRows, data.config.tdCutover],
  )
  const editingRow = editingId ? data.allRows.find((row) => row.id === editingId) : undefined
  // TD rows that don't count yet (Monarch's copy does, before the switch-over).
  const tdCopies = useMemo(() => {
    const counted = new Set(data.transactions.map((t) => t.id.split('#')[0]))
    return data.allRows.filter((row) => row.source === 'td' && !row.duplicateOf && !counted.has(row.id))
  }, [data.transactions, data.allRows])
  const [incomingFile, setIncomingFile] = useState<File | null>(null)
  const rememberWatchName = useCallback(
    (name: string | undefined) => data.saveSettings({ ...data.config, watchFolderName: name }),
    [data.config, data.saveSettings],
  )
  const watch = useWatchFolder(
    data.config.lastExport,
    data.batches[0]?.fileName,
    data.config.watchFolderName,
    rememberWatchName,
  )

  // The month-end screen settles one month at a time, so it keeps a month of
  // its own rather than following a period that may span a year.
  // In the first half of a month, the month to close is the one just ended.
  const [workMonth, setWorkMonth] = useState(() => {
    const now = today()
    const [y, m] = now.slice(0, 7).split('-').map(Number)
    const previous = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`
    return Number(now.slice(8, 10)) <= 15 ? previous : now.slice(0, 7)
  })

  return (
    <div ref={areaRef} className="fixed inset-0 z-40 overflow-y-auto bg-sand-50 animate-fade">
      <header ref={headerRef} className="sticky top-0 z-10 border-b border-sand-200/70 bg-sand-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-tide-700">
                Expenses
              </span>
              <span className="block text-[11px] text-ink-400">
                {data.loading
                  ? 'Opening…'
                  : `${data.transactions.length.toLocaleString()} transactions · ${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {!data.loading && <CountingBadge counting={counting} onOpen={() => setTab('settings')} />}
            <nav className="flex items-center gap-1">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={
                    tab === id
                      ? 'rounded-full bg-tide-600 px-3.5 py-1.5 text-xs font-medium text-white'
                      : 'btn-quiet text-xs'
                  }
                >
                  {label}
                  {id === 'weekly' && weekly.needCount > 0 && (
                    <span
                      className={`ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                        tab === id ? 'bg-white text-tide-700' : 'bg-shell-500 text-white'
                      }`}
                      aria-label={`${weekly.needCount} steps need you`}
                    >
                      {weekly.needCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            {PERIODIC.includes(tab) && (
              <PeriodSelector period={period} months={data.months} onChange={onPeriodChange} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {data.notice && (
              <span className="max-w-md truncate text-xs text-ink-500 animate-fade">
                {data.notice}
              </span>
            )}
            <button onClick={onLock} className="btn-quiet text-xs">
              Lock
            </button>
            <button onClick={onClose} className="btn-ghost text-xs">
              Back to budget
            </button>
            <button onClick={onOpenChat} className="btn-primary text-xs">
              Ask a question
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {data.loading ? (
          <p className="py-16 text-center text-sm text-ink-400">Decrypting your expenses…</p>
        ) : (
          <>
            {tab !== 'settings' && onRestoreBackup && (
              <FreshnessBar
                freshness={freshness}
                onRestore={onRestoreBackup}
                backup={{
                  ...(safeguards.ageDays !== undefined ? { ageDays: safeguards.ageDays } : {}),
                  current: weekly.backup === 'done',
                  busy: safeguards.busy,
                  onBackUp: () => void safeguards.backUp(),
                  ...(safeguards.auto && safeguards.folder && !safeguards.folder.allowed
                    ? { waitingFor: safeguards.folder.name, onAllow: () => void safeguards.allowFolder() }
                    : {}),
                }}
              />
            )}
            {watch.supported && (
              <input
                id={WATCH_FOLDER_INPUT_ID}
                type="file"
                multiple
                className="sr-only"
                {...{ webkitdirectory: '', directory: '' }}
                onChange={watch.onInputChange}
              />
            )}
            {watch.offer && (
              <div className="mb-6 rounded-2xl border border-tide-200 bg-white/70 px-4 py-3.5">
                <p className="text-sm text-ink-900">
                  {lastImportPhrase(data)
                    ? `${watch.offer.file.name} is newer than the ${lastImportPhrase(data)} import. Review it?`
                    : `${watch.offer.file.name} is in the watched folder. Review it?`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setIncomingFile(watch.offer!.file)
                      watch.dismissOffer()
                      setTab('weekly')
                    }}
                    className="btn-primary text-xs"
                  >
                    Review
                  </button>
                  <button onClick={watch.dismissOffer} className="btn-ghost text-xs">
                    Not now
                  </button>
                </div>
              </div>
            )}
            {!watch.offer && watch.supported && watch.folderName && watch.csvCount === undefined && (
              <div className="mb-6 rounded-2xl border border-sand-200 bg-white/70 px-4 py-3.5">
                <p className="text-sm text-ink-900">
                  To check “{watch.folderName}” for a new export, choose that folder again.
                </p>
                <label
                  htmlFor={WATCH_FOLDER_INPUT_ID}
                  className="btn-ghost mt-3 cursor-pointer text-xs"
                >
                  Check
                </label>
              </div>
            )}

            {tab === 'month' && (
              <WorkflowPanel
                data={data}
                budget={budgetAt(budget, data.forecastConfig.planHistory, workMonth)}
                month={workMonth}
                onMonthChange={setWorkMonth}
                onEdit={(t) => setEditingId(t.id.split('#')[0]!)}
                safeguards={safeguards}
                {...(onRestoreBackup ? { onRestoreBackup } : {})}
                backupState={weekly.backup}
                {...(travelGoal ? { travelTarget: travelGoal } : {})}
              />
            )}

            {tab === 'budget' && (
              <BudgetPanel
                budget={budgetOver(budget, data.forecastConfig.planHistory, monthKeys(period))}
                accounts={data.accounts}
                transactions={data.budgetRows}
                period={period}
                reimbursableTag={data.config.reimbursableTag}
              />
            )}

            {tab === 'overview' && (
              <ForecastPanel
                transactions={data.budgetRows}
                budget={budget}
                config={data.forecastConfig}
                reimbursableParentTag={data.config.reimbursableTag}
                onConfigChange={(config) => void data.saveForecastSettings(config)}
                onSnapshot={(snapshot) => void data.saveMonthSnapshot(snapshot)}
                onNotice={data.flash}
                onPlanRaise={async ({ note, ...raise }) => {
                  const history = data.forecastConfig.planHistory
                  const change = { ...raise, amount: planAmountAt(budget, history, raise.key, raise.month) + raise.amount }
                  if (raise.onward && onExpensesChange) {
                    const next = withPlanChange(budget, history, change)
                    await data.saveForecastSettings({
                      ...data.forecastConfig,
                      planHistory: next.history,
                      ...notesFor(data.forecastConfig.planNotes, raise, note, true),
                    })
                    onExpensesChange(next.budget.expenses)
                  } else {
                    await data.saveForecastSettings({
                      ...data.forecastConfig,
                      planHistory: withPlanForMonth(budget, history, change),
                      ...notesFor(data.forecastConfig.planNotes, raise, note, false),
                    })
                  }
                }}
                onEdit={(t) => setEditingId(t.id.split('#')[0]!)}
                onPlanForMonth={async ({ note, ...change }: PlanChangeRequest) => {
                  await data.saveForecastSettings({
                    ...data.forecastConfig,
                    planHistory: withPlanForMonth(budget, data.forecastConfig.planHistory, change),
                    ...notesFor(data.forecastConfig.planNotes, change, note, false),
                  })
                }}
                {...(onExpensesChange
                  ? {
                      onPlanChange: async ({ note, ...change }: PlanChangeRequest) => {
                        const next = withPlanChange(budget, data.forecastConfig.planHistory, change)
                        await data.saveForecastSettings({
                          ...data.forecastConfig,
                          planHistory: next.history,
                          ...notesFor(data.forecastConfig.planNotes, change, note, true),
                        })
                        onExpensesChange(next.budget.expenses)
                      },
                    }
                  : {})}
              />
            )}

            {tab === 'transactions' && (
              <TransactionsPanel
                accounts={data.accounts}
                transactions={data.budgetRows}
                comparisonRows={tdCopies}
                period={period}
                reimbursableTag={data.config.reimbursableTag}
                groups={data.config.categoryGroups}
                onEdit={(t) => setEditingId(t.id.split('#')[0]!)}
                onCreateAccount={data.persistAccount}
                onAddManual={data.addManual}
                onRemove={data.removeManual}
              />
            )}

            {tab === 'weekly' && (
              <WeeklyCheckIn
                status={weekly}
                {...(weeklyDone ? { lastDone: weeklyDone } : {})}
                onMarkDone={() => {
                  const day = today()
                  writeWeeklyDone(day)
                  setWeeklyDone(day)
                }}
                steps={[
                  {
                    key: 'read',
                    title: 'Download and read the TD statements',
                    hint: 'Download from TD on the Mac, then read the folder: new transactions, pending card charges and, at month end, closing balances.',
                    state: weekly.read,
                    body: <TdStatementsCard data={data} />,
                  },
                  {
                    key: 'duplicates',
                    title: 'Possible duplicates',
                    hint: 'Charges that came in twice (re-dated or re-priced between downloads).',
                    state: weekly.duplicates,
                    ...(duplicateCount > 0 ? { detail: `${duplicateCount} to check` } : {}),
                    body: duplicateCount > 0 ? <DuplicatesCard data={data} /> : <p className="text-sm text-ink-500">None this week.</p>,
                  },
                  {
                    key: 'file',
                    title: 'File the transactions',
                    hint: 'Confirm what the rules filed, and fix what they didn’t — this month and last.',
                    state: weekly.file,
                    ...(weekly.toFile > 0 ? { detail: `${weekly.toFile} to file` } : {}),
                    body: <ReviewPanel data={data} />,
                  },
                  ...(weekly.compare === 'notNeeded'
                    ? []
                    : [
                        {
                          key: 'compare',
                          title: 'Compare with Monarch',
                          hint: 'Until Monarch is cancelled: bring in its export; only pending charges should differ.',
                          state: weekly.compare,
                          body: (
                            <div className="space-y-3">
                              <FeedCompareCard data={data} period={monthPeriod(today().slice(0, 7))} />
                              <RulesCompareCard data={data} />
                              <ImportPanel
                                accounts={data.accounts}
                                transactions={data.allRows}
                                groups={data.config.categoryGroups}
                                {...(earliestSwitch(data) ? { switchedFrom: earliestSwitch(data) } : {})}
                                batches={data.batches}
                                incomingFile={incomingFile}
                                onIncomingConsumed={() => setIncomingFile(null)}
                                onCreateAccount={data.persistAccount}
                                onCommit={async (plan, fingerprint) => {
                                  await data.applyImport(plan, fingerprint)
                                  watch.dismissOffer()
                                }}
                                onUndo={data.revertBatch}
                              />
                            </div>
                          ),
                        },
                      ]),
                  {
                    key: 'backup',
                    title: 'Back up',
                    hint: 'Save this week’s work, so the iPad can restore it.',
                    state: weekly.backup,
                    body: <BackupCard safeguards={safeguards} {...(onRestoreBackup ? { onRestore: onRestoreBackup } : {})} />,
                  },
                ]}
              />
            )}

            {tab === 'settings' && (
              <AccountsPanel
                accounts={data.accounts}
                transactionCounts={data.transactionCounts}
                onSave={(account) => void data.persistAccount(account)}
                onDelete={(account) => void data.removeAccount(account)}
              />
            )}

            {tab === 'settings' && (
              <div className="mb-6 space-y-6">
                <KeyCard unlockedKey={unlockedKey} onKeyChanged={onKeyChanged} onBackUp={safeguards.backUp} />
                <BackupCard safeguards={safeguards} {...(onRestoreBackup ? { onRestore: onRestoreBackup } : {})} />
                <ReimbursableSettingsCard data={data} />
                <SwitchOverCard data={data} />
                <RulesSettingsCard data={data} />
              </div>
            )}

            {tab === 'settings' && (
              <SettingsPanel
                transactions={data.transactions}
                budget={budget}
                config={data.forecastConfig}
                reimbursableParentTag={data.config.reimbursableTag}
                onConfigChange={(config) => void data.saveForecastSettings(config)}
                onWipe={onWipe}
                watch={{
                  supported: watch.supported,
                  folderName: watch.folderName,
                  csvCount: watch.csvCount,
                  newestName: watch.newestName,
                  notice: watch.notice,
                  onForget: watch.forgetFolder,
                }}
              />
            )}
          </>
        )}
      </main>
      {editingRow && (
        <Modal
          open
          onClose={() => setEditingId(null)}
          width="max-w-5xl"
          title={`Edit ${editingRow.merchant || 'transaction'}`}
          subtitle={`${editingRow.date} · ${editingRow.originalStatement || 'entered by hand'} · ${editingRow.amount.toFixed(2)}`}
        >
          <TransactionEditor data={data} row={editingRow} onDone={() => setEditingId(null)} />
        </Modal>
      )}
    </div>
  )
}

/** Always in the header: where today's rows come from. Anything short of TD stands out. */
function CountingBadge({ counting, onOpen }: { counting: CountingFrom; onOpen: () => void }) {
  const onTd = counting.mode === 'td'
  const label =
    counting.mode === 'td'
      ? `TD · from ${counting.from}`
      : counting.mode === 'mixed'
        ? `TD on ${counting.onTd} of ${counting.accounts} accounts · the rest on Monarch`
        : counting.from
          ? `Monarch · TD from ${counting.from}`
          : 'Monarch · not switched to TD'
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Which rows count in this copy of Tidewater. Rows dated before the switch-over still come from Monarch. Open Settings to see the date."
      className={
        onTd
          ? 'rounded-full bg-tide-100 px-3 py-1.5 text-xs font-semibold text-tide-700'
          : 'rounded-full bg-shell-500 px-3 py-1.5 text-xs font-semibold text-white'
      }
    >
      Counting: {label}
    </button>
  )
}

function lastImportPhrase(data: EtmData): string | undefined {
  if (data.config.lastExport) {
    return new Date(data.config.lastExport.lastModified).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }
  const latest = data.batches[0]
  if (!latest) return undefined
  return new Date(latest.importedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function earliestSwitch(data: EtmData): string | undefined {
  const cutover = data.config.tdCutover
  if (!cutover) return undefined
  return [cutover.global, ...Object.values(cutover.perAccount)].filter((d): d is string => Boolean(d)).sort()[0]
}

/**
 * The notes after a plan change: a change from a month on drops notes on the
 * later changes it replaces; the new note, if any, goes on its month.
 */
function notesFor(
  notes: PlanNotes | undefined,
  change: { key: string; label: string; month: string },
  note: PlanNoteDraft | undefined,
  onward: boolean,
): { planNotes?: PlanNotes } {
  let next = onward ? withoutNotesAfter(notes, change.key, change.month) : notes
  if (note && (note.text.trim() || note.reviewBy)) {
    next = withChangeNote(next, { key: change.key, label: change.label, month: change.month, ...note })
  }
  return next ? { planNotes: next } : {}
}

