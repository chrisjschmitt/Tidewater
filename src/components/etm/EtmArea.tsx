import { useCallback, useEffect, useMemo, useState } from 'react'
import AccountsPanel from './AccountsPanel'
import ActivityPanel from './ActivityPanel'
import ImportPanel from './ImportPanel'
import type { ImportPlan } from '../../lib/etm/importer'
import {
  addManualTransaction,
  commitImport,
  deleteAccount,
  loadAccounts,
  loadBatches,
  loadTransactions,
  removeTransaction,
  saveAccount,
  undoBatch,
} from '../../lib/etm/storage/repo'
import type { Account, ImportBatch, Transaction } from '../../lib/etm/types'

interface Props {
  unlockedKey: CryptoKey
  onClose: () => void
  onLock: () => void
  onWipe: () => void
}

type Tab = 'activity' | 'import' | 'accounts'

const TABS: Array<[Tab, string]> = [
  ['activity', 'Activity'],
  ['import', 'Import'],
  ['accounts', 'Accounts'],
]

export default function EtmArea({ unlockedKey, onClose, onLock, onWipe }: Props) {
  const [tab, setTab] = useState<Tab>('activity')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    const [nextAccounts, nextTransactions, nextBatches] = await Promise.all([
      loadAccounts(unlockedKey),
      loadTransactions(unlockedKey),
      loadBatches(unlockedKey),
    ])
    setAccounts(nextAccounts)
    setTransactions(nextTransactions)
    setBatches(nextBatches)
  }, [unlockedKey])

  useEffect(() => {
    void (async () => {
      await reload()
      setLoading(false)
    })()
  }, [reload])

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 5000)
  }

  const transactionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of transactions) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1)
    return counts
  }, [transactions])

  /**
   * Only one account can pay for everything, and only one can be where the
   * surplus goes, so setting either role clears it elsewhere.
   */
  const persistAccount = useCallback(
    async (account: Account) => {
      const exclusive = accounts.filter(
        (a) =>
          a.id !== account.id &&
          ((account.funding && a.funding) ||
            (account.savingsDestination && a.savingsDestination)),
      )
      for (const other of exclusive) {
        await saveAccount(unlockedKey, {
          ...other,
          funding: account.funding ? false : other.funding,
          savingsDestination: account.savingsDestination ? false : other.savingsDestination,
        })
      }
      await saveAccount(unlockedKey, account)
      await reload()
    },
    [accounts, reload, unlockedKey],
  )

  const applyImport = useCallback(
    async (plan: ImportPlan) => {
      await commitImport(unlockedKey, plan)
      await reload()
      setTab('activity')
      flash(
        `Brought in ${plan.added.length.toLocaleString()} new and refreshed ${plan.updated.length.toLocaleString()}.`,
      )
    },
    [reload, unlockedKey],
  )

  const revertBatch = useCallback(
    async (batch: ImportBatch) => {
      await undoBatch(unlockedKey, batch.id)
      await reload()
      flash(`Undid the import of ${batch.fileName}.`)
    },
    [reload, unlockedKey],
  )

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-sand-50 animate-fade">
      <header className="sticky top-0 z-10 border-b border-sand-200/70 bg-sand-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-tide-700">
                Expenses
              </span>
              <span className="block text-[11px] text-ink-400">
                {loading
                  ? 'Opening…'
                  : `${transactions.length.toLocaleString()} transactions · ${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
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
          </div>
          <div className="flex items-center gap-2">
            {notice && (
              <span className="hidden max-w-md truncate text-xs text-ink-500 sm:block animate-fade">
                {notice}
              </span>
            )}
            <button onClick={onLock} className="btn-quiet text-xs">
              Lock
            </button>
            <button onClick={onClose} className="btn-ghost text-xs">
              Back to budget
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {loading ? (
          <p className="py-16 text-center text-sm text-ink-400">Decrypting your expenses…</p>
        ) : (
          <>
            {tab === 'activity' && (
              <ActivityPanel
                accounts={accounts}
                transactions={transactions}
                onCreateAccount={persistAccount}
                onAddManual={async (transaction) => {
                  await addManualTransaction(unlockedKey, transaction)
                  await reload()
                  flash('Added.')
                }}
                onRemove={async (transaction) => {
                  await removeTransaction(unlockedKey, transaction)
                  await reload()
                }}
              />
            )}

            {tab === 'import' && (
              <ImportPanel
                accounts={accounts}
                transactions={transactions}
                batches={batches}
                onCreateAccount={persistAccount}
                onCommit={applyImport}
                onUndo={revertBatch}
              />
            )}

            {tab === 'accounts' && (
              <AccountsPanel
                accounts={accounts}
                transactionCounts={transactionCounts}
                onSave={(account) => void persistAccount(account)}
                onDelete={(account) => {
                  void (async () => {
                    await deleteAccount(account.id)
                    await reload()
                  })()
                }}
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
