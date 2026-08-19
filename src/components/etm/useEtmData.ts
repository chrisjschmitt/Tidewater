import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_CONFIG, type EtmConfig } from '../../lib/etm/config'
import { DEFAULT_FORECAST_CONFIG, type ForecastConfig } from '../../lib/forecast/types'
import type { ImportPlan } from '../../lib/etm/importer'
import {
  addManualTransaction,
  commitImport,
  deleteAccount,
  deleteBalance,
  deleteReconciliation,
  loadAccounts,
  loadBalances,
  loadBatches,
  loadConfig,
  loadForecastConfig,
  loadReconciliations,
  loadTransactions,
  removeTransaction,
  saveAccount,
  saveBalance,
  saveConfig,
  saveForecastConfig,
  saveReconciliation,
  undoBatch,
} from '../../lib/etm/storage/repo'
import {
  monthOf,
  type Account,
  type BalanceSnapshot,
  type ImportBatch,
  type ReconciliationRecord,
  type Transaction,
} from '../../lib/etm/types'

export interface EtmData {
  loading: boolean
  accounts: Account[]
  transactions: Transaction[]
  batches: ImportBatch[]
  balances: BalanceSnapshot[]
  reconciliations: ReconciliationRecord[]
  config: EtmConfig
  forecastConfig: ForecastConfig
  saveSettings: (config: EtmConfig) => Promise<void>
  saveForecastSettings: (config: ForecastConfig) => Promise<void>
  recordBalance: (snapshot: BalanceSnapshot) => Promise<void>
  removeBalance: (snapshot: BalanceSnapshot) => Promise<void>
  recordMonth: (record: ReconciliationRecord) => Promise<void>
  reopenMonth: (month: string) => Promise<void>
  /** Months holding data, oldest first — what the period selector offers. */
  months: string[]
  transactionCounts: Map<string, number>
  notice: string
  persistAccount: (account: Account) => Promise<void>
  removeAccount: (account: Account) => Promise<void>
  applyImport: (plan: ImportPlan) => Promise<void>
  revertBatch: (batch: ImportBatch) => Promise<void>
  addManual: (transaction: Transaction) => Promise<void>
  removeManual: (transaction: Transaction) => Promise<void>
}

/**
 * One owner for the decrypted data, so the dashboard strip and the full
 * expenses area read the same rows and never decrypt the store twice.
 */
export function useEtmData(unlockedKey: CryptoKey): EtmData {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [balances, setBalances] = useState<BalanceSnapshot[]>([])
  const [reconciliations, setReconciliations] = useState<ReconciliationRecord[]>([])
  const [config, setConfig] = useState<EtmConfig>(DEFAULT_CONFIG)
  const [forecastConfig, setForecastConfig] = useState<ForecastConfig>(DEFAULT_FORECAST_CONFIG)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    const [nextAccounts, nextTransactions, nextBatches, nextConfig, nextForecast, nextBalances, nextRecords] =
      await Promise.all([
        loadAccounts(unlockedKey),
        loadTransactions(unlockedKey),
        loadBatches(unlockedKey),
        loadConfig(unlockedKey),
        loadForecastConfig(unlockedKey),
        loadBalances(unlockedKey),
        loadReconciliations(unlockedKey),
      ])
    setAccounts(nextAccounts)
    setTransactions(nextTransactions)
    setBatches(nextBatches)
    setConfig(nextConfig)
    setForecastConfig(nextForecast)
    setBalances(nextBalances)
    setReconciliations(nextRecords)
  }, [unlockedKey])

  useEffect(() => {
    void (async () => {
      await reload()
      setLoading(false)
    })()
  }, [reload])

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 5000)
  }, [])

  const months = useMemo(() => {
    const seen = new Set(transactions.map((t) => monthOf(t.date)))
    return [...seen].sort()
  }, [transactions])

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
          ((account.funding && a.funding) || (account.savingsDestination && a.savingsDestination)),
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

  const saveSettings = useCallback(
    async (next: EtmConfig) => {
      await saveConfig(unlockedKey, next)
      setConfig(next)
    },
    [unlockedKey],
  )

  const saveForecastSettings = useCallback(
    async (next: ForecastConfig) => {
      await saveForecastConfig(unlockedKey, next)
      setForecastConfig(next)
    },
    [unlockedKey],
  )

  const recordBalance = useCallback(
    async (snapshot: BalanceSnapshot) => {
      await saveBalance(unlockedKey, snapshot)
      setBalances(await loadBalances(unlockedKey))
      flash(`Balance recorded for ${snapshot.date}.`)
    },
    [unlockedKey, flash],
  )

  const removeBalance = useCallback(
    async (snapshot: BalanceSnapshot) => {
      await deleteBalance(snapshot.id)
      setBalances(await loadBalances(unlockedKey))
    },
    [unlockedKey],
  )

  const recordMonth = useCallback(
    async (record: ReconciliationRecord) => {
      await saveReconciliation(unlockedKey, record)
      setReconciliations(await loadReconciliations(unlockedKey))
      flash(
        record.status === 'reconciled'
          ? `${record.month} is closed.`
          : `${record.month} saved as still open.`,
      )
    },
    [unlockedKey, flash],
  )

  const reopenMonth = useCallback(
    async (month: string) => {
      await deleteReconciliation(month)
      setReconciliations(await loadReconciliations(unlockedKey))
      flash(`${month} is open again.`)
    },
    [unlockedKey, flash],
  )

  const removeAccount = useCallback(
    async (account: Account) => {
      await deleteAccount(account.id)
      await reload()
    },
    [reload],
  )

  const applyImport = useCallback(
    async (plan: ImportPlan) => {
      await commitImport(unlockedKey, plan)
      await reload()
      flash(
        `Brought in ${plan.added.length.toLocaleString()} new and refreshed ${plan.updated.length.toLocaleString()}.`,
      )
    },
    [flash, reload, unlockedKey],
  )

  const revertBatch = useCallback(
    async (batch: ImportBatch) => {
      await undoBatch(unlockedKey, batch.id)
      await reload()
      flash(`Undid the import of ${batch.fileName}.`)
    },
    [flash, reload, unlockedKey],
  )

  const addManual = useCallback(
    async (transaction: Transaction) => {
      await addManualTransaction(unlockedKey, transaction)
      await reload()
      flash('Added.')
    },
    [flash, reload, unlockedKey],
  )

  const removeManual = useCallback(
    async (transaction: Transaction) => {
      await removeTransaction(unlockedKey, transaction)
      await reload()
    },
    [reload, unlockedKey],
  )

  return {
    loading,
    accounts,
    transactions,
    batches,
    balances,
    reconciliations,
    config,
    forecastConfig,
    saveSettings,
    saveForecastSettings,
    recordBalance,
    removeBalance,
    recordMonth,
    reopenMonth,
    months,
    transactionCounts,
    notice,
    persistAccount,
    removeAccount,
    applyImport,
    revertBatch,
    addManual,
    removeManual,
  }
}
