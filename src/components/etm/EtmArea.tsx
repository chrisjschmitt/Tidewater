import { useCallback, useState } from 'react'
import AccountsPanel from './AccountsPanel'
import BudgetPanel from './BudgetPanel'
import ForecastPanel from './ForecastPanel'
import ImportPanel from './ImportPanel'
import TdStatementsCard from './TdStatementsCard'
import RulesCompareCard from './RulesCompareCard'
import RulesSettingsCard from './RulesSettingsCard'
import ReviewPanel from './ReviewPanel'
import TransactionEditor from './TransactionEditor'
import Modal from '../Modal'
import SwitchOverCard from './SwitchOverCard'
import PeriodSelector from './PeriodSelector'
import ReimbursablePanel from './ReimbursablePanel'
import SettingsPanel from './SettingsPanel'
import WorkflowPanel from './WorkflowPanel'
import TransactionsPanel from './TransactionsPanel'
import { useWatchFolder, WATCH_FOLDER_INPUT_ID } from './useWatchFolder'
import type { EtmData } from './useEtmData'
import { monthKeys, type Period } from '../../lib/etm/period'
import { budgetAt, budgetOver, withPlanChange } from '../../lib/forecast/planHistory'
import type { Budget } from '../../lib/types'

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
}

type Tab = 'month' | 'budget' | 'forecast' | 'reimbursable' | 'transactions' | 'review' | 'import' | 'accounts' | 'settings'

const TABS: Array<[Tab, string]> = [
  ['month', 'Month end'],
  ['budget', 'Budget'],
  ['forecast', 'Forecast'],
  ['reimbursable', 'Reimbursable'],
  ['transactions', 'Transactions'],
  ['review', 'Review'],
  ['import', 'Import'],
  ['accounts', 'Accounts'],
  ['settings', 'Settings'],
]

/** The period selector is hidden on tabs it does not govern. */
const PERIODIC: Tab[] = ['budget', 'reimbursable', 'transactions']

export default function EtmArea({
  data,
  budget,
  period,
  onPeriodChange,
  onClose,
  onLock,
  onWipe,
  onOpenChat,
  onApplyHouseholdContribution,
  onExpensesChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('budget')
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingRow = editingId ? data.allRows.find((row) => row.id === editingId) : undefined
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
  const [workMonth, setWorkMonth] = useState(
    () => data.months.at(-1) ?? new Date().toISOString().slice(0, 7),
  )

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-sand-50 animate-fade">
      <header className="sticky top-0 z-10 border-b border-sand-200/70 bg-sand-50/80 backdrop-blur-md">
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
                      setTab('import')
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
                onOpenImport={() => setTab('import')}
              />
            )}

            {tab === 'budget' && (
              <BudgetPanel
                budget={budgetOver(budget, data.forecastConfig.planHistory, monthKeys(period))}
                accounts={data.accounts}
                transactions={data.transactions}
                reconciliations={data.reconciliations}
                period={period}
                reimbursableTag={data.config.reimbursableTag}
              />
            )}

            {tab === 'forecast' && (
              <ForecastPanel
                transactions={data.transactions}
                budget={budget}
                config={data.forecastConfig}
                reimbursableParentTag={data.config.reimbursableTag}
                lastMonthSnapshot={data.lastMonthSnapshot}
                onConfigChange={(config) => void data.saveForecastSettings(config)}
                onSnapshot={(snapshot) => void data.saveMonthSnapshot(snapshot)}
                onNotice={data.flash}
                onOpenTidy={() => setTab('month')}
                onApplyHouseholdContribution={onApplyHouseholdContribution}
                {...(onExpensesChange
                  ? {
                      onPlanChange: async (change: { key: string; label: string; month: string; amount: number }) => {
                        const next = withPlanChange(budget, data.forecastConfig.planHistory, change)
                        await data.saveForecastSettings({ ...data.forecastConfig, planHistory: next.history })
                        onExpensesChange(next.budget.expenses)
                      },
                    }
                  : {})}
              />
            )}

            {tab === 'reimbursable' && (
              <ReimbursablePanel
                accounts={data.accounts}
                transactions={data.transactions}
                period={period}
                config={data.config}
                onConfigChange={(config) => void data.saveSettings(config)}
              />
            )}

            {tab === 'transactions' && (
              <TransactionsPanel
                accounts={data.accounts}
                transactions={data.transactions}
                period={period}
                reimbursableTag={data.config.reimbursableTag}
                groups={data.config.categoryGroups}
                onEdit={(t) => setEditingId(t.id.split('#')[0]!)}
                onCreateAccount={data.persistAccount}
                onAddManual={data.addManual}
                onRemove={data.removeManual}
              />
            )}

            {tab === 'review' && <ReviewPanel data={data} />}

            {tab === 'import' && (
              <div className="mb-6 space-y-3">
                <TdStatementsCard data={data} />
                <RulesCompareCard data={data} />
              </div>
            )}

            {tab === 'import' && (
              <h3 className="mb-2 px-1 text-sm font-semibold text-ink-900">Monarch export</h3>
            )}

            {tab === 'import' && (
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
                  setTab('transactions')
                }}
                onUndo={data.revertBatch}
              />
            )}

            {tab === 'accounts' && (
              <AccountsPanel
                accounts={data.accounts}
                transactionCounts={data.transactionCounts}
                onSave={(account) => void data.persistAccount(account)}
                onDelete={(account) => void data.removeAccount(account)}
              />
            )}

            {tab === 'settings' && (
              <div className="mb-6 space-y-6">
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
          width="max-w-3xl"
          title={`Edit ${editingRow.merchant || 'transaction'}`}
          subtitle={`${editingRow.date} · ${editingRow.originalStatement || 'entered by hand'} · ${editingRow.amount.toFixed(2)}`}
        >
          <TransactionEditor data={data} row={editingRow} onDone={() => setEditingId(null)} />
        </Modal>
      )}
    </div>
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
