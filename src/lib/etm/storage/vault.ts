import {
  cryptoAvailable,
  deriveKey,
  PBKDF2_ITERATIONS,
  randomSalt,
  sealSentinel,
  sentinelMatches,
} from '../crypto'
import { deleteEtmDb, openEtmDb, type VaultMeta } from './db'
import { setEtmPresence } from '../../storage'

/**
 * Short enough not to argue with someone who has chosen a key and shared it,
 * long enough that a slip of the finger cannot silently create a vault that
 * can never be opened again.
 */
export const MIN_KEY_LENGTH = 8

export type UnlockFailure = 'wrong-key' | 'unavailable'

export type UnlockResult = { ok: true; key: CryptoKey } | { ok: false; reason: UnlockFailure }

export async function readVaultMeta(): Promise<VaultMeta | undefined> {
  const db = await openEtmDb()
  try {
    return await db.get('meta', 'vault')
  } finally {
    db.close()
  }
}

/** First use of the key on this device. Fails if a vault is already here. */
export async function createVault(passphrase: string, remember: boolean): Promise<UnlockResult> {
  if (!cryptoAvailable()) return { ok: false, reason: 'unavailable' }

  const salt = randomSalt()
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const meta: VaultMeta = {
    version: 1,
    salt,
    iterations: PBKDF2_ITERATIONS,
    sentinel: await sealSentinel(key),
    createdAt: new Date().toISOString(),
  }

  const db = await openEtmDb()
  try {
    await db.put('meta', meta, 'vault')
  } finally {
    db.close()
  }

  await rememberKey(remember ? key : null)
  await setEtmPresence({ setUp: true, remembered: remember })
  return { ok: true, key }
}

export async function unlockVault(passphrase: string, remember: boolean): Promise<UnlockResult> {
  if (!cryptoAvailable()) return { ok: false, reason: 'unavailable' }

  const meta = await readVaultMeta()
  if (!meta) return { ok: false, reason: 'wrong-key' }

  const key = await deriveKey(passphrase, meta.salt, meta.iterations)
  if (!(await sentinelMatches(key, meta.sentinel))) return { ok: false, reason: 'wrong-key' }

  await rememberKey(remember ? key : null)
  await setEtmPresence({ setUp: true, remembered: remember })
  return { ok: true, key }
}

/**
 * The stored key is non-extractable, so what lands in IndexedDB is a handle
 * the browser will use for decryption but will not spell out — a copy of the
 * database file alone does not carry the key with it.
 */
async function rememberKey(key: CryptoKey | null): Promise<void> {
  const db = await openEtmDb()
  try {
    if (key) await db.put('unlock', { key, rememberedAt: new Date().toISOString() }, 'remembered')
    else await db.delete('unlock', 'remembered')
  } finally {
    db.close()
  }
}

/** The key from a previous session, when the user asked to stay unlocked. */
export async function rememberedKey(): Promise<CryptoKey | null> {
  const db = await openEtmDb()
  try {
    const stored = await db.get('unlock', 'remembered')
    return stored?.key ?? null
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** Lock: drop the persisted key so the next session must present the passphrase. */
export async function forgetRememberedKey(): Promise<void> {
  await rememberKey(null)
  await setEtmPresence({ setUp: true, remembered: false })
}

/** Erase everything the module has stored on this device. */
export async function wipeVault(): Promise<void> {
  await deleteEtmDb()
  await setEtmPresence(null)
}
