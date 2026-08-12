import { open, seal } from '../crypto'
import type { EtmDb, RecordStore } from './db'

/**
 * Reading and writing sealed records. Every value that crosses into IndexedDB
 * goes through here, so there is exactly one place to be sure nothing is
 * written in the clear.
 *
 * Note that a decryption is an ordinary promise, not an IndexedDB one, so
 * awaiting it ends any transaction in progress. Callers therefore read, then
 * decrypt, then write — one small transaction at a time rather than one large
 * one. At this data scale that costs nothing.
 */

export async function putSealed(
  db: EtmDb,
  store: RecordStore,
  key: CryptoKey,
  id: string,
  value: unknown,
): Promise<void> {
  await db.put(store, { id, sealed: await seal(key, value) })
}

export async function getSealed<T>(
  db: EtmDb,
  store: RecordStore,
  key: CryptoKey,
  id: string,
): Promise<T | undefined> {
  const record = await db.get(store, id)
  return record ? await open<T>(key, record.sealed) : undefined
}

export async function allSealed<T>(db: EtmDb, store: RecordStore, key: CryptoKey): Promise<T[]> {
  const records = await db.getAll(store)
  const values: T[] = []
  for (const record of records) values.push(await open<T>(key, record.sealed))
  return values
}

export async function deleteSealed(db: EtmDb, store: RecordStore, id: string): Promise<void> {
  await db.delete(store, id)
}

/** Record ids are plaintext, so this never reveals more than which keys exist. */
export function sealedIds(db: EtmDb, store: RecordStore): Promise<string[]> {
  return db.getAllKeys(store) as Promise<string[]>
}
