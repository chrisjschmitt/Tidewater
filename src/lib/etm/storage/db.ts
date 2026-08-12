import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Sealed } from '../crypto'

/**
 * A database of its own, so a schema change here can never disturb the budget
 * the rest of Tidewater depends on. Every store below holds ciphertext keyed
 * by a plaintext id; the ids are meaningless without the key.
 */
const DB_NAME = 'tidewater-etm'
const DB_VERSION = 1

/** What was recorded at setup so a later unlock can reproduce the same key. */
export interface VaultMeta {
  version: 1
  salt: Uint8Array
  iterations: number
  sentinel: Sealed
  createdAt: string
}

/** The derived key itself, kept only when the user asks to stay unlocked. */
export interface RememberedUnlock {
  key: CryptoKey
  rememberedAt: string
}

/** Encrypted payload plus the little metadata that must stay readable. */
export interface SealedRecord {
  id: string
  sealed: Sealed
}

interface EtmSchema extends DBSchema {
  meta: { key: 'vault'; value: VaultMeta }
  unlock: { key: 'remembered'; value: RememberedUnlock }
  accounts: { key: string; value: SealedRecord }
  transactions: { key: string; value: SealedRecord }
  balances: { key: string; value: SealedRecord }
  batches: { key: string; value: SealedRecord }
  reconciliations: { key: string; value: SealedRecord }
  config: { key: string; value: SealedRecord }
}

export type EtmDb = IDBPDatabase<EtmSchema>

const RECORD_STORES = [
  'accounts',
  'transactions',
  'balances',
  'batches',
  'reconciliations',
  'config',
] as const

export function openEtmDb(): Promise<EtmDb> {
  return openDB<EtmSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('unlock')) db.createObjectStore('unlock')
      for (const name of RECORD_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
    },
  })
}

export async function deleteEtmDb(): Promise<void> {
  await deleteDB(DB_NAME, {
    // Another tab holding the database open would otherwise stall the delete
    // silently. Reloading is heavy-handed but honest: the user asked for the
    // data to be gone, and it will be by the time the page comes back.
    blocked() {
      console.warn('Expense tracking data cannot be erased while another Tidewater tab is open.')
    },
  })
}
