import { withDefaults, type EtmConfig } from '../config'
import type { ImportPlan } from '../importer'
import { monthOf, type Account, type ImportBatch, type Transaction } from '../types'
import { openEtmDb, type EtmDb } from './db'
import { allSealed, deleteSealed, getSealed, putSealed, sealedIds } from './records'

/**
 * The encrypted store, expressed in the module's own vocabulary.
 *
 * Transactions are held in month-sized chunks — a month is both the unit the
 * workflow thinks in and small enough that a re-import rewrites very little.
 * Everything else is one sealed record apiece.
 */

async function withDb<T>(work: (db: EtmDb) => Promise<T>): Promise<T> {
  const db = await openEtmDb()
  try {
    return await work(db)
  } finally {
    db.close()
  }
}

// --- configuration ---------------------------------------------------------

const CONFIG_ID = 'etm'

export function loadConfig(key: CryptoKey): Promise<EtmConfig> {
  return withDb(async (db) =>
    withDefaults(await getSealed<Partial<EtmConfig>>(db, 'config', key, CONFIG_ID)),
  )
}

export function saveConfig(key: CryptoKey, config: EtmConfig): Promise<void> {
  return withDb((db) => putSealed(db, 'config', key, CONFIG_ID, config))
}

// --- accounts --------------------------------------------------------------

export function loadAccounts(key: CryptoKey): Promise<Account[]> {
  return withDb(async (db) => {
    const accounts = await allSealed<Account>(db, 'accounts', key)
    return accounts.sort((a, z) => a.nickname.localeCompare(z.nickname))
  })
}

export function saveAccount(key: CryptoKey, account: Account): Promise<void> {
  return withDb((db) => putSealed(db, 'accounts', key, account.id, account))
}

export function deleteAccount(id: string): Promise<void> {
  return withDb((db) => deleteSealed(db, 'accounts', id))
}

// --- transactions ----------------------------------------------------------

/** Which months hold data. The chunk keys are plaintext, so this needs no key. */
export function loadMonths(): Promise<string[]> {
  return withDb(async (db) => (await sealedIds(db, 'transactions')).sort())
}

export function loadTransactions(key: CryptoKey): Promise<Transaction[]> {
  return withDb(async (db) => {
    const chunks = await allSealed<Transaction[]>(db, 'transactions', key)
    return chunks.flat().sort(byDateDescending)
  })
}

export function addManualTransaction(key: CryptoKey, transaction: Transaction): Promise<void> {
  return withDb(async (db) => {
    const month = monthOf(transaction.date)
    const current = (await getSealed<Transaction[]>(db, 'transactions', key, month)) ?? []
    await putSealed(db, 'transactions', key, month, [...current, transaction].sort(byDateDescending))
  })
}

export function removeTransaction(key: CryptoKey, transaction: Transaction): Promise<void> {
  return withDb(async (db) => {
    const month = monthOf(transaction.date)
    const current = (await getSealed<Transaction[]>(db, 'transactions', key, month)) ?? []
    const kept = current.filter((t) => t.id !== transaction.id)
    if (kept.length === 0) await deleteSealed(db, 'transactions', month)
    else await putSealed(db, 'transactions', key, month, kept)
  })
}

// --- imports ---------------------------------------------------------------

export function commitImport(key: CryptoKey, plan: ImportPlan): Promise<ImportBatch> {
  return withDb(async (db) => {
    const incoming = new Map<string, Transaction[]>()
    const collect = (transaction: Transaction) => {
      const month = monthOf(transaction.date)
      const list = incoming.get(month) ?? []
      list.push(transaction)
      incoming.set(month, list)
    }
    for (const transaction of plan.added) collect(transaction)
    for (const { next } of plan.updated) collect(next)

    for (const [month, transactions] of incoming) {
      const current = (await getSealed<Transaction[]>(db, 'transactions', key, month)) ?? []
      const merged = new Map(current.map((t) => [t.id, t]))
      for (const transaction of transactions) merged.set(transaction.id, transaction)
      await putSealed(db, 'transactions', key, month, [...merged.values()].sort(byDateDescending))
    }

    const batch: ImportBatch = {
      id: plan.batchId,
      fileName: plan.fileName,
      importedAt: new Date().toISOString(),
      firstDate: plan.firstDate,
      lastDate: plan.lastDate,
      months: [...incoming.keys()].sort(),
      addedIds: plan.added.map((t) => t.id),
      replaced: plan.updated.map(({ previous }) => previous),
      rowsRead: plan.rowsRead,
      unchanged: plan.unchanged,
    }
    await putSealed(db, 'batches', key, batch.id, batch)
    return batch
  })
}

export function loadBatches(key: CryptoKey): Promise<ImportBatch[]> {
  return withDb(async (db) => {
    const batches = await allSealed<ImportBatch>(db, 'batches', key)
    return batches.sort((a, z) => z.importedAt.localeCompare(a.importedAt))
  })
}

/**
 * Puts the store back exactly as it was before an import: rows the batch
 * created are removed, and rows it overwrote are restored from the copies
 * kept on the batch.
 */
export function undoBatch(key: CryptoKey, batchId: string): Promise<void> {
  return withDb(async (db) => {
    const batch = await getSealed<ImportBatch>(db, 'batches', key, batchId)
    if (!batch) return

    const added = new Set(batch.addedIds)
    const restored = new Map<string, Transaction[]>()
    for (const transaction of batch.replaced) {
      const month = monthOf(transaction.date)
      const list = restored.get(month) ?? []
      list.push(transaction)
      restored.set(month, list)
    }

    for (const month of batch.months) {
      const current = (await getSealed<Transaction[]>(db, 'transactions', key, month)) ?? []
      const kept = new Map(current.filter((t) => !added.has(t.id)).map((t) => [t.id, t]))
      for (const transaction of restored.get(month) ?? []) kept.set(transaction.id, transaction)

      if (kept.size === 0) await deleteSealed(db, 'transactions', month)
      else await putSealed(db, 'transactions', key, month, [...kept.values()].sort(byDateDescending))
    }

    await deleteSealed(db, 'batches', batchId)
  })
}

const byDateDescending = (a: Transaction, z: Transaction) =>
  z.date.localeCompare(a.date) || a.merchant.localeCompare(z.merchant)
