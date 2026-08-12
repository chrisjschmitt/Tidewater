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
  aggregate,
  compareToBudget,
  filterTransactions,
  isEmpty,
  noFilters,
  runningTotals,
  sumOf,
  type BudgetComparison,
} from '../src/lib/etm/aggregate.ts'
import {
  monthKeys,
  monthPeriod,
  monthsInPeriod,
  rangePeriod,
  ytdPeriod,
} from '../src/lib/etm/period.ts'
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
import type { Budget, GroupId } from '../src/lib/types.ts'

let failures = 0

function check(label: string, passed: boolean, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!passed) failures++
}

/** Money compared to the cent, so summing floats never fails a check. */
const round = (n: number) => Math.round(n * 100) / 100

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

// ---------------------------------------------------------------------------
// Periods and aggregation
// ---------------------------------------------------------------------------

console.log('\n=== Periods ===')

const december = monthPeriod('2025-12')
check('a month runs to its last day', december.start === '2025-12-01' && december.end === '2025-12-31')
check('February knows its length', monthPeriod('2024-02').end === '2024-02-29')
check('one month is one month of plan', monthsInPeriod(december) === 1)
check('year to date counts calendar months', monthsInPeriod(ytdPeriod('2025-08-12')) === 8, `${monthsInPeriod(ytdPeriod('2025-08-12'))}`)
check('a range across a year boundary counts through', monthsInPeriod(rangePeriod('2024-11-15', '2025-02-03')) === 4)
check('a reversed range is put right', rangePeriod('2025-05-01', '2025-01-01').start === '2025-01-01')
check('month keys cover the period', monthKeys(rangePeriod('2024-11-15', '2025-02-03')).join(' ') === '2024-11 2024-12 2025-01 2025-02')

console.log('\n=== December actuals ===')

const all = first.added
const dec = aggregate(all, december)

check('internal movements are set aside', dec.internal === 4, `${dec.internal}`)
check('everything else is counted', dec.counted === 28, `${dec.counted}`)
check('income is summed', round(dec.income.CAD) === 6062.4, `${round(dec.income.CAD)}`)
check('spending is summed', round(dec.spend.CAD) === 3470.48, `${round(dec.spend.CAD)}`)
check('USD is kept apart from CAD', round(dec.spend.USD) === 24, `${round(dec.spend.USD)}`)
check('no transfer leaked into a total', round(dec.income.CAD) !== 6262.4 && round(dec.spend.CAD) !== 4270.48)

const EXPECTED_GROUP_SPEND: Array<[GroupId, number]> = [
  ['home', 1930],
  ['joy', 571.98],
  ['food', 406.5],
  ['transport', 318],
  ['personal', 120],
  ['health', 70],
  ['future', 50],
  ['financial', 4],
]
for (const [groupId, expected] of EXPECTED_GROUP_SPEND) {
  const actual = round(dec.byGroup.get(groupId)?.spend.CAD ?? 0)
  check(`${groupId} spent ${expected}`, actual === expected, `${actual}`)
}
check(
  'group totals add up to the whole',
  round([...dec.byGroup.values()].reduce((s, g) => s + g.spend.CAD, 0)) === round(dec.spend.CAD),
)
check(
  'a USD-only category reports no CAD',
  dec.byGroup.get('personal')?.categories.some((c) => c.label === 'Software' && c.spend.CAD === 0 && c.spend.USD === 24),
)

console.log('\n=== Netting and exclusions ===')

// April holds a refund posted back to the category it came from.
const april = aggregate(all, monthPeriod('2025-04'))
const restaurants = april.byGroup.get('joy')?.categories.find((c) => c.label === 'Restaurants')
check('a refund nets against its own category', round(restaurants?.spend.CAD ?? 0) === 68, `${round(restaurants?.spend.CAD ?? 0)}`)
check('a refund is not counted as income', !april.categories.some((c) => c.label === 'Restaurants' && c.isIncome))

const usdAccount = accounts[4]!
const withoutUsd = aggregate(all, december, { excludeAccountIds: new Set([usdAccount.id]) })
check('an excluded account leaves the totals', withoutUsd.spend.USD === 0)
check('excluding one account leaves the others alone', round(withoutUsd.spend.CAD) === round(dec.spend.CAD))

const year = aggregate(all, rangePeriod('2025-01-01', '2025-12-31'))
check('a full year covers twelve months of plan', year.months === 12)
check('a year counts more than a month', year.counted > dec.counted, `${year.counted}`)

console.log('\n=== Budget versus actual ===')

const plan: Budget = {
  version: 1,
  profile: { name: '', housing: 'rent', household: 'single', dependents: 0, hasDebt: false, region: '' },
  income: [{ id: 'i1', name: 'Salary', amount: 4850 }],
  expenses: [
    { id: 'e1', name: 'Rent', groupId: 'home', amount: 1600 },
    { id: 'e2', name: 'groceries', groupId: 'food', amount: 400 },
    { id: 'e3', name: 'Piano lessons', groupId: 'family', amount: 100 },
  ],
  goals: [],
  updatedAt: new Date().toISOString(),
  source: 'budget-csv',
}

const monthly = compareToBudget(plan, dec)
check('one month of plan is the plan itself', monthly.plannedTotal === 2100, `${monthly.plannedTotal}`)

const rent = findRow(monthly, 'home', 'Rent')
check('a planned line meets its spending', rent?.planned === 1600 && round(rent.actual.CAD) === 1650)
check('a matched line is marked matched', rent?.status === 'both')

const groceries = findRow(monthly, 'food', 'groceries')
check('matching ignores case', groceries?.status === 'both' && round(groceries.actual.CAD) === 345, `${groceries?.status}`)

const piano = findRow(monthly, 'family', 'Piano lessons')
check('a planned line with no spending still shows', piano?.status === 'planned-only' && isEmpty(piano.actual))

const unplanned = findRow(monthly, 'home', 'Utilities')
check('spending with no plan still shows', unplanned?.status === 'unplanned' && unplanned.planned === 0)

check(
  'every category is accounted for somewhere',
  monthly.groups.flatMap((g) => g.categories).filter((c) => c.status !== 'planned-only').length ===
    dec.categories.filter((c) => !c.isIncome).length,
)
check('the actual total matches the aggregate', round(monthly.actualTotal.CAD) === round(dec.spend.CAD))
check('USD rides alongside, never added in', round(monthly.actualTotal.USD) === 24)

const twoMonths = compareToBudget(plan, aggregate(all, rangePeriod('2025-11-01', '2025-12-31')))
check('two months of plan is twice the plan', twoMonths.plannedTotal === 4200, `${twoMonths.plannedTotal}`)
check('the plan scales but the actuals do not', round(twoMonths.actualTotal.CAD) > round(monthly.actualTotal.CAD))

console.log('\n=== Filtering the transactions view ===')

const base = noFilters()
check('by default the period alone applies', filterTransactions(all, december, base).length === 28)
check('internal rows can be brought back', filterTransactions(all, december, { ...base, includeInternal: true }).length === 32)

const groceriesOnly = filterTransactions(all, december, { ...base, categories: ['Groceries'] })
check('by category', groceriesOnly.length === 2 && round(-sumOf(groceriesOnly).CAD) === 345)

const foodOnly = filterTransactions(all, december, { ...base, groupIds: ['food'] })
check('by group', foodOnly.length === 6, `${foodOnly.length}`)

const usdOnly = filterTransactions(all, december, { ...base, accountIds: [usdAccount.id] })
check('by account', usdOnly.length === 1 && usdOnly[0]!.currency === 'USD')

const tagged = filterTransactions(all, year.period, { ...base, tags: ['Reimbursable'] })
check('by tag', tagged.length === 7, `${tagged.length}`)

const owned = filterTransactions(all, year.period, { ...base, owners: ['Sam'] })
check('by owner', owned.length === 4, `${owned.length}`)

// Nine, because the floor is on size and so catches the paycheque too.
const large = filterTransactions(all, december, { ...base, minAmount: 100 })
check('by amount floor', large.every((t) => Math.abs(t.amount) >= 100) && large.length === 9, `${large.length}`)

const window = filterTransactions(all, december, { ...base, minAmount: 50, maxAmount: 100 })
check('by amount window', window.every((t) => Math.abs(t.amount) >= 50 && Math.abs(t.amount) <= 100))

// Three: the same-day duplicate pair, plus one earlier in the month.
const searched = filterTransactions(all, december, { ...base, text: 'corner bean' })
check('by text, case-insensitively', searched.length === 3, `${searched.length}`)
check(
  'text reaches the statement and notes',
  filterTransactions(all, december, { ...base, text: 'client trip' }).length === 1,
)

const combined = filterTransactions(all, december, { ...base, groupIds: ['food'], text: 'green basket' })
check('filters combine', combined.length === 2 && round(-sumOf(combined).CAD) === 345)

const totals = runningTotals(groceriesOnly)
check('a running subtotal accumulates', totals.length === 2 && round(totals[1]!.CAD) === -345)

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)

function findRow(comparison: BudgetComparison, groupId: GroupId, name: string) {
  return comparison.groups
    .find((g) => g.group.id === groupId)
    ?.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
}

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
