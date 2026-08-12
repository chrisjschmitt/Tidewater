/**
 * Encryption for the expense tracking module.
 *
 * Everything here uses the Web Crypto API that ships with the browser, so no
 * dependency is added and no key material ever leaves the page. The derived
 * key is non-extractable: once made, not even Tidewater's own code can read
 * the bytes back out, which is what lets it be persisted safely for the
 * optional "stay unlocked" setting.
 */

/**
 * OWASP's floor for PBKDF2-SHA-256 at the time of writing. Raising this later
 * is safe for new vaults but would lock existing ones out, so the iteration
 * count used at setup is stored alongside the salt rather than assumed.
 */
export const PBKDF2_ITERATIONS = 600_000

const SALT_BYTES = 16
const IV_BYTES = 12

/**
 * Decrypting this successfully is the only proof that a key is the right one.
 * It is a fixed public string — its value is not a secret, its ciphertext is
 * simply unforgeable without the key.
 */
const SENTINEL = 'tidewater-etm-v1'

/** An AES-GCM ciphertext with the random IV it was produced under. */
export interface Sealed {
  iv: Uint8Array
  data: Uint8Array
}

/** False in insecure contexts (plain http on a non-localhost origin). */
export function cryptoAvailable(): boolean {
  return typeof globalThis.crypto?.subtle !== 'undefined'
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES))
}

/**
 * Stretch the user's key into an AES-GCM key. Deliberately slow — roughly a
 * quarter-second — so guessing at the key is expensive for anyone who copies
 * the encrypted store off the device.
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypt any JSON-serialisable value under a fresh random IV. */
export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  return sealText(key, JSON.stringify(value))
}

export async function open<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  return JSON.parse(await openText(key, sealed)) as T
}

async function sealText(key: CryptoKey, text: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(text),
  )
  return { iv, data: new Uint8Array(data) }
}

async function openText(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv as BufferSource },
    key,
    sealed.data as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

export function sealSentinel(key: CryptoKey): Promise<Sealed> {
  return sealText(key, SENTINEL)
}

/**
 * A wrong key makes AES-GCM's authentication tag fail, which throws rather
 * than returning garbage — so both the throw and a mismatched value mean the
 * same thing to the caller: not this key.
 */
export async function sentinelMatches(key: CryptoKey, sealed: Sealed): Promise<boolean> {
  try {
    return (await openText(key, sealed)) === SENTINEL
  } catch {
    return false
  }
}
