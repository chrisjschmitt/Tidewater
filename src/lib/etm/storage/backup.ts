import { setEtmPresence } from '../../storage'
import { RECORD_STORES, openEtmDb, type RecordStore, type SealedRecord, type VaultMeta } from './db'
import { readVaultMeta } from './vault'

/** JSON-safe ciphertext. The key is never in this object. */
export interface EtmVaultBackup {
  version: 1
  salt: string
  iterations: number
  sentinel: { iv: string; data: string }
  createdAt: string
  stores: Record<RecordStore, Array<{ id: string; iv: string; data: string }>>
}

/**
 * Pack IndexedDB ciphertext (plus the salt that lets the same key open it)
 * into JSON. Returns null when this device has no vault, so a plan-only
 * backup stays exactly the file Tidewater has always written.
 */
export async function exportEtmVault(): Promise<EtmVaultBackup | null> {
  const meta = await readVaultMeta()
  if (!meta) return null

  const db = await openEtmDb()
  try {
    const stores = emptyStores()
    for (const name of RECORD_STORES) {
      stores[name] = await db.getAll(name)
    }
    return encodeVaultBackup(meta, stores)
  } finally {
    db.close()
  }
}

/**
 * Replace this device's vault with the ciphertext from a backup. Does not
 * restore a remembered unlock — the other machine must present the same key.
 * The dump is validated before any store is cleared.
 */
export async function restoreEtmVault(raw: unknown): Promise<void> {
  const decoded = decodeVaultBackup(raw)
  if (!decoded) throw new Error('That backup’s expenses vault could not be read.')

  const db = await openEtmDb()
  try {
    const tx = db.transaction(['meta', 'unlock', ...RECORD_STORES], 'readwrite')
    await tx.objectStore('unlock').delete('remembered')
    await tx.objectStore('meta').put(decoded.meta, 'vault')
    for (const name of RECORD_STORES) {
      const store = tx.objectStore(name)
      await store.clear()
      for (const record of decoded.stores[name]) await store.put(record)
    }
    await tx.done
  } finally {
    db.close()
  }

  await setEtmPresence({ setUp: true, remembered: false })
}

export function isEtmVaultBackup(raw: unknown): raw is EtmVaultBackup {
  return asEtmVaultBackup(raw) !== null
}

/** Turn live sealed records into base64 so JSON.stringify cannot mangle IVs. */
export function encodeVaultBackup(
  meta: VaultMeta,
  stores: Record<RecordStore, SealedRecord[]>,
): EtmVaultBackup {
  const encoded = emptyEncodedStores()
  for (const name of RECORD_STORES) {
    encoded[name] = (stores[name] ?? []).map((record) => ({
      id: record.id,
      iv: bytesToBase64(asBytes(record.sealed.iv)),
      data: bytesToBase64(asBytes(record.sealed.data)),
    }))
  }
  return {
    version: 1,
    salt: bytesToBase64(asBytes(meta.salt)),
    iterations: meta.iterations,
    sentinel: {
      iv: bytesToBase64(asBytes(meta.sentinel.iv)),
      data: bytesToBase64(asBytes(meta.sentinel.data)),
    },
    createdAt: meta.createdAt,
    stores: encoded,
  }
}

/**
 * Inverse of `encodeVaultBackup`. Returns null for anything that is not a
 * complete vault dump, so a bad `etm` field cannot wipe a working store.
 */
export function decodeVaultBackup(
  raw: unknown,
): { meta: VaultMeta; stores: Record<RecordStore, SealedRecord[]> } | null {
  const encoded = asEtmVaultBackup(raw)
  if (!encoded) return null

  try {
    const stores = emptyStores()
    for (const name of RECORD_STORES) {
      stores[name] = encoded.stores[name].map((record) => ({
        id: record.id,
        sealed: { iv: base64ToBytes(record.iv), data: base64ToBytes(record.data) },
      }))
    }
    return {
      meta: {
        version: 1,
        salt: base64ToBytes(encoded.salt),
        iterations: encoded.iterations,
        sentinel: {
          iv: base64ToBytes(encoded.sentinel.iv),
          data: base64ToBytes(encoded.sentinel.data),
        },
        createdAt: encoded.createdAt,
      },
      stores,
    }
  } catch {
    return null
  }
}

function asEtmVaultBackup(raw: unknown): EtmVaultBackup | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  if (typeof raw.salt !== 'string' || raw.salt.length === 0) return null
  if (typeof raw.iterations !== 'number' || !Number.isFinite(raw.iterations) || raw.iterations < 1) {
    return null
  }
  if (!isRecord(raw.sentinel) || !isB64(raw.sentinel.iv) || !isB64(raw.sentinel.data)) return null
  if (typeof raw.createdAt !== 'string' || raw.createdAt.length === 0) return null
  if (!isRecord(raw.stores)) return null

  const stores = emptyEncodedStores()
  for (const name of RECORD_STORES) {
    const list = raw.stores[name]
    if (list === undefined) {
      stores[name] = []
      continue
    }
    if (!Array.isArray(list) || !list.every(isEncodedRecord)) return null
    stores[name] = list
  }

  return {
    version: 1,
    salt: raw.salt,
    iterations: raw.iterations,
    sentinel: { iv: raw.sentinel.iv, data: raw.sentinel.data },
    createdAt: raw.createdAt,
    stores,
  }
}

function emptyStores(): Record<RecordStore, SealedRecord[]> {
  return {
    accounts: [],
    transactions: [],
    balances: [],
    batches: [],
    reconciliations: [],
    config: [],
  }
}

function emptyEncodedStores(): EtmVaultBackup['stores'] {
  return {
    accounts: [],
    transactions: [],
    balances: [],
    batches: [],
    reconciliations: [],
    config: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isB64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isEncodedRecord(value: unknown): value is { id: string; iv: string; data: string } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isB64(value.iv) &&
    isB64(value.data)
  )
}

function asBytes(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
