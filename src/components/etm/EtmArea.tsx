import { useState } from 'react'
import AccountsPanel from './AccountsPanel'
import BudgetPanel from './BudgetPanel'
import ForecastPanel from './ForecastPanel'
import ImportPanel from './ImportPanel'
import PeriodSelector from './PeriodSelector'
import ReimbursablePanel from './ReimbursablePanel'
import WorkflowPanel from './WorkflowPanel'
import TransactionsPanel from './TransactionsPanel'
import type { EtmData } from './useEtmData'
import type { Period } from '../../lib/etm/period'
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
}

type Tab = 'month' | 'budget' | 'forecast' | 'reimbursable' | 'transactions' | 'import' | 'accounts'

const TABS: Array<[Tab, string]> = [
  ['month', 'Month end'],
  ['budget', 'Budget'],
  ['forecast', 'Forecast'],
  ['reimbursable', 'Reimbursable'],
  ['transactions', 'Transactions'],
  ['import', 'Import'],
  ['accounts', 'Accounts'],
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
}: Props) {
  const [tab, setTab] = useState<Tab>('budget')
  const [confirmingWipe, setConfirmingWipe] = useState(false)

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
            {tab === 'month' && (
              <WorkflowPanel
                data={data}
                budget={budget}
                month={workMonth}
                onMonthChange={setWorkMonth}
              />
            )}

            {tab === 'budget' && (
              <BudgetPanel
                budget={budget}
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
                onCreateAccount={data.persistAccount}
                onAddManual={data.addManual}
                onRemove={data.removeManual}
              />
            )}

            {tab === 'import' && (
              <ImportPanel
                accounts={data.accounts}
                transactions={data.transactions}
                batches={data.batches}
                onCreateAccount={data.persistAccount}
                onCommit={async (plan) => {
                  await data.applyImport(plan)
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
          </>
        )}

        <section className="mt-8 max-w-xl rounded-2xl border border-shell-300/50 bg-shell-300/10 px-4 py-3.5">
          <p className="text-sm font-medium text-ink-900">Erase expense data</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Removes this device’s encrypted expense store and the key setup along with it. Your
            budget, goals, and profile are untouched, and everything here can be imported again
            from Monarch.
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
      </main>
    </div>
  )
}
