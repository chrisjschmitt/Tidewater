/**
 * Sanity check for the expense tracking module's encryption layer.
 * Usage: npm run check:etm
 *
 * Runs against Node's Web Crypto — the same API the browser provides — so the
 * guarantees the module rests on can be checked without a browser. No personal
 * data is involved: every value here is invented in this file.
 *
 * The storage layer needs IndexedDB and so is exercised in the browser instead.
 */
import {
  PBKDF2_ITERATIONS,
  deriveKey,
  open,
  randomSalt,
  seal,
  sealSentinel,
  sentinelMatches,
} from '../src/lib/etm/crypto.ts'

let failures = 0

function check(label: string, passed: boolean, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!passed) failures++
}

const KEY = 'correct horse battery staple'
const WRONG_KEY = 'correct horse battery stapl'

console.log('=== Key derivation ===')

const salt = randomSalt()
const started = Date.now()
const key = await deriveKey(KEY, salt)
const derivationMs = Date.now() - started
check('derives an AES-GCM key', key.algorithm.name === 'AES-GCM')
check('key is non-extractable', key.extractable === false)
check(
  'derivation is deliberately slow',
  derivationMs >= 50,
  `${PBKDF2_ITERATIONS.toLocaleString()} iterations in ${derivationMs} ms`,
)

const sameKey = await deriveKey(KEY, salt)
const sameSalt = await seal(sameKey, 'shared')
check('same key and salt decrypt each other', (await open(key, sameSalt)) === 'shared')

const otherSalt = randomSalt()
check('two salts differ', Buffer.compare(Buffer.from(salt), Buffer.from(otherSalt)) !== 0)

console.log('\n=== Round trip ===')

const record = {
  id: 'txn-0001',
  date: '2026-03-14',
  merchant: 'Invented Grocery Co',
  amount: -42.5,
  currency: 'CAD',
  tags: ['fixture'],
}
const sealed = await seal(key, record)
const reopened = await open<typeof record>(key, sealed)
check('a record survives encrypt then decrypt', JSON.stringify(reopened) === JSON.stringify(record))
check('the ciphertext does not contain the plaintext', !bytesContain(sealed.data, 'Invented Grocery Co'))
check('the IV is 96 bits', sealed.iv.length === 12)

const again = await seal(key, record)
check('the same value seals under a fresh IV', Buffer.compare(Buffer.from(sealed.iv), Buffer.from(again.iv)) !== 0)
check(
  'identical input produces different ciphertext',
  Buffer.compare(Buffer.from(sealed.data), Buffer.from(again.data)) !== 0,
)

console.log('\n=== Tamper detection ===')

const tampered = { iv: sealed.iv, data: Uint8Array.from(sealed.data) }
tampered.data[0] ^= 0xff
check('a flipped byte is rejected', await throws(() => open(key, tampered)))

const wrongIv = { iv: randomIv(), data: sealed.data }
check('a swapped IV is rejected', await throws(() => open(key, wrongIv)))

console.log('\n=== Sentinel (key verification) ===')

const sentinel = await sealSentinel(key)
check('the right key opens the sentinel', await sentinelMatches(key, sentinel))

const wrong = await deriveKey(WRONG_KEY, salt)
check('a near-miss key does not', !(await sentinelMatches(wrong, sentinel)))

const rightKeyWrongSalt = await deriveKey(KEY, otherSalt)
check('the right key with another salt does not', !(await sentinelMatches(rightKeyWrongSalt, sentinel)))
check('a wrong key reports rather than throws', (await sentinelMatches(wrong, sentinel)) === false)

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

function bytesContain(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'utf8'))
}

async function throws(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work()
    return false
  } catch {
    return true
  }
}
