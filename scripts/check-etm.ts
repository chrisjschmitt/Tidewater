/**
 * Sanity check for the expense tracking module's engine: encryption, the
 * Monarch parser, and the import pipeline.
 * Usage: npm run check:etm
 *
 * Runs against Node's Web Crypto — the same API the browser provides — so the
 * guarantees the module rests on can be checked without a browser. No personal
 * data is involved: the sanitized fixture and the values invented here are all
 * it ever reads.
 *
 * The storage layer needs IndexedDB and so is exercised in the browser instead.
 */
import { readFileSync } from 'node:fs'
import { groupForCategory } from '../src/lib/categories.ts'
import {
  PBKDF2_ITERATIONS,
  deriveKey,
  open,
  randomSalt,
  seal,
  sealSentinel,
  sentinelMatches,
} from '../src/lib/etm/crypto.ts'
import { findUnmatchedAccounts, planImport } from '../src/lib/etm/importer.ts'
import { createManualTransaction } from '../src/lib/etm/manual.ts'
import { MonarchFormatError, parseMonarchCsv } from '../src/lib/etm/monarch.ts'
import type { Account, Transaction } from '../src/lib/etm/types.ts'
import type { GroupId } from '../src/lib/types.ts'

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

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

const FIXTURE = 'public/sample/monarch-fixture.csv'
const fixture = readFileSync(FIXTURE, 'utf8')

console.log('\n=== Monarch parser ===')

const parsed = parseMonarchCsv(fixture)
check('reads the fixture', parsed.rows.length > 0, `${parsed.rows.length} rows`)
check('drops nothing unexpectedly', parsed.skipped === 0, `${parsed.skipped} skipped`)
check(
  'a missing column is refused with a helpful error',
  await refusesHeader('Date,Merchant,Amount\n2025-01-01,Somewhere,-1.00\n', ['Category', 'Account']),
)

console.log('\n=== Account matching ===')

const accounts: Account[] = [
  account('Everyday spending', 'chequing', 'CAD', 'Chequing (...1001)', { funding: true, float: 500 }),
  account('Rainy day', 'savings', 'CAD', 'Savings (...2002)', { savingsDestination: true }),
  account('Blue card', 'credit', 'CAD', 'Visa (...4242)'),
  account('Pocket cash', 'chequing', 'CAD', 'Cash'),
  account('Travel card', 'credit', 'USD', 'US Card (...7788)', { excludedFromBudget: true }),
]

const unmatched = findUnmatchedAccounts(parsed.rows, [])
check('an empty registry leaves every account unmatched', unmatched.length === accounts.length, unmatched.map((u) => u.monarchName).join(', '))
check('a full registry leaves none unmatched', findUnmatchedAccounts(parsed.rows, accounts).length === 0)
check(
  'unmatched accounts are reported with row counts',
  unmatched.every((u) => u.rows > 0 && u.sample !== ''),
)

const partial = findUnmatchedAccounts(parsed.rows, accounts.slice(0, 3))
check('a partial registry reports only what is missing', partial.length === 2, partial.map((u) => u.monarchName).join(', '))

console.log('\n=== First import ===')

const first = await planImport(fixture, { fileName: 'fixture.csv', accounts, existing: new Map() })
check('every row becomes a transaction', first.added.length === parsed.rows.length, `${first.added.length} added`)
check('nothing is updated on a first import', first.updated.length === 0)
check('nothing is unchanged on a first import', first.unchanged === 0)
check('the date range is read off the file', first.firstDate === '2025-01-01' && first.lastDate === '2025-12-30', `${first.firstDate} to ${first.lastDate}`)
check('months are chunked', first.months.length === 12, first.months.join(' '))

console.log('\n=== Categorization (the existing group rules) ===')

const byCategory = new Map<string, Transaction>()
for (const t of first.added) if (!byCategory.has(t.category)) byCategory.set(t.category, t)

const EXPECTED_GROUPS: Array<[string, GroupId]> = [
  ['Rent', 'home'],
  ['Groceries', 'food'],
  ['Gas', 'transport'],
  ['Fitness', 'health'],
  ['Software', 'personal'],
  ['Airfare', 'joy'],
  ['Pets', 'family'],
  ['Bank Fees', 'financial'],
  ['Charity', 'future'],
  ['Office Supplies', 'other'],
]
for (const [category, expected] of EXPECTED_GROUPS) {
  const found = byCategory.get(category)
  check(`${category} → ${expected}`, found?.groupId === expected, found ? `got ${found.groupId}` : 'category missing from fixture')
}

check(
  'category spelling is kept verbatim',
  first.added.some((t) => t.category === 'GROCERIES') && first.added.some((t) => t.category === 'Groceries'),
)

console.log('\n=== Internal movements ===')

const INTERNAL_CATEGORIES = new Set(['Transfer', 'Credit Card Payment'])
const flaggedInternal = first.added.filter((t) => t.internal)
check(
  'transfers and card payments are flagged',
  flaggedInternal.every((t) => INTERNAL_CATEGORIES.has(t.category)),
  `${flaggedInternal.length} rows`,
)
check(
  'nothing else is flagged',
  first.added.every((t) => t.internal === INTERNAL_CATEGORIES.has(t.category)),
)
check('the flag count matches the plan', first.internal === flaggedInternal.length)

console.log('\n=== Currency (no conversion, ever) ===')

const usd = first.added.filter((t) => t.monarchAccount === 'US Card (...7788)')
check('USD rows are marked USD', usd.length > 0 && usd.every((t) => t.currency === 'USD'), `${usd.length} rows`)
check(
  'every other row stays CAD',
  first.added.filter((t) => t.monarchAccount !== 'US Card (...7788)').every((t) => t.currency === 'CAD'),
)

console.log('\n=== Identity and dedup ===')

const ids = new Set(first.added.map((t) => t.id))
check('every id is distinct', ids.size === first.added.length, `${ids.size} of ${first.added.length}`)

const sameDay = first.added.filter((t) => t.date === '2025-12-30' && t.merchant === 'Corner Bean')
check('identical rows in one file stay distinct', sameDay.length === 2 && sameDay[0]!.id !== sameDay[1]!.id)

const reparsed = await planImport(fixture, { fileName: 'fixture.csv', accounts, existing: new Map() })
check(
  'ids are stable across a fresh parse',
  reparsed.added.every((t, i) => t.id === first.added[i]!.id),
)

const stored = new Map(first.added.map((t) => [t.id, t]))
const second = await planImport(fixture, { fileName: 'fixture.csv', accounts, existing: stored })
check('importing the same file twice adds nothing', second.added.length === 0)
check('importing the same file twice updates nothing', second.updated.length === 0)
check('every row is recognised as already stored', second.unchanged === parsed.rows.length, `${second.unchanged} unchanged`)

console.log('\n=== Re-import after editing in Monarch ===')

const edited = fixture.replace(
  '2025-12-29,Skyway Air,Airfare,Visa (...4242),SKYWAY AIR,Client trip,-410.00,Reimbursable,Alex,',
  '2025-12-29,Skyway Air,Travel,Visa (...4242),SKYWAY AIR,Client trip,-410.00,"Reimbursable,Travel",Alex,Yes',
)
check('the fixture line to edit was found', edited !== fixture)

const third = await planImport(edited, { fileName: 'fixture.csv', accounts, existing: stored })
check('a re-categorized row is an update, not a duplicate', third.added.length === 0 && third.updated.length === 1)
check('the rest are still recognised', third.unchanged === parsed.rows.length - 1)

const change = third.updated[0]
check('the id survived the edit', change?.next.id === change?.previous.id)
check('the new category is taken', change?.next.category === 'Travel', change?.next.category)
check('the new tag is taken', change?.next.tags.join(',') === 'Reimbursable,Travel', change?.next.tags.join(','))
check('the reviewed flag is taken', change?.next.reviewed === true)
check('the group is re-derived', change?.next.groupId === groupForCategory('Travel'))
check('a tag-only edit is enough to count as changed', await tagEditIsAnUpdate())

console.log('\n=== Manual entries ===')

const cash = createManualTransaction(
  {
    date: '2025-12-15',
    merchant: 'Farmers market',
    category: 'Groceries',
    amount: 24,
    spend: true,
    notes: 'cash',
    tags: [],
    owner: 'Sam',
  },
  accounts[3]!,
)
check('a manual entry is signed as spending', cash.amount === -24)
check('a manual entry takes its account currency', cash.currency === 'CAD')
check('a manual entry is grouped by the same rules', cash.groupId === 'food')
check('a manual entry is marked manual', cash.source === 'manual')

// Same id as a stored monarch row, to prove the guard rather than rely on
// generated ids never colliding.
const disguised = new Map(stored)
const victim = first.added.find((t) => t.category === 'Groceries')!
disguised.set(victim.id, { ...victim, source: 'manual', category: 'Cash groceries' })
const fourth = await planImport(fixture, { fileName: 'fixture.csv', accounts, existing: disguised })
check(
  'an import never overwrites a manual row',
  fourth.updated.every(({ previous }) => previous.source !== 'manual'),
)

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)

function account(
  nickname: string,
  kind: Account['kind'],
  currency: Account['currency'],
  monarchName: string,
  extra: Partial<Account> = {},
): Account {
  return {
    id: `acct-${nickname.toLowerCase().replace(/\s+/g, '-')}`,
    nickname,
    kind,
    currency,
    monarchName,
    funding: false,
    savingsDestination: false,
    excludedFromBudget: false,
    ...extra,
  }
}

async function refusesHeader(text: string, expectedMissing: string[]): Promise<boolean> {
  try {
    parseMonarchCsv(text)
    return false
  } catch (err) {
    return (
      err instanceof MonarchFormatError &&
      expectedMissing.every((column) => err.missing.includes(column))
    )
  }
}

/** Tags are an array, so they need comparing by value rather than reference. */
async function tagEditIsAnUpdate(): Promise<boolean> {
  const tagged = fixture.replace(
    '2025-11-29,Harbour Rail,Transit,Visa (...4242),HARBOUR RAIL,,-52.00,Reimbursable,Sam,',
    '2025-11-29,Harbour Rail,Transit,Visa (...4242),HARBOUR RAIL,,-52.00,"Reimbursable,Commute",Sam,',
  )
  if (tagged === fixture) return false
  const plan = await planImport(tagged, { fileName: 'fixture.csv', accounts, existing: stored })
  return plan.added.length === 0 && plan.updated.length === 1
}

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
