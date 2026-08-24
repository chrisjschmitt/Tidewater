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
  dashboardActuals,
  filterTransactions,
  isEmpty,
  isReimbursable,
  noFilters,
  runningTotals,
  sumOf,
  type BudgetComparison,
} from '../src/lib/etm/aggregate.ts'
import { bucketOf } from '../src/lib/etm/tags.ts'
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
import { DEFAULT_CONFIG, withBucketSetting } from '../src/lib/etm/config.ts'
import {
  closedPlanTrend,
  planSpendAtClose,
  withPlanAtClose,
} from '../src/lib/etm/closedPlan.ts'
import { findUnmatchedAccounts, planImport } from '../src/lib/etm/importer.ts'
import {
  StatementFormatError,
  parseStatementCsv,
  parseStatementDate,
} from '../src/lib/etm/statement.ts'
import {
  computeSavings,
  dayBefore,
  findUntidy,
  latestSnapshot,
  reconcile,
  reimbursementPivot,
  type Reconciliation,
} from '../src/lib/etm/workflow.ts'
import { createManualTransaction } from '../src/lib/etm/manual.ts'
import { MonarchFormatError, parseMonarchCsv } from '../src/lib/etm/monarch.ts'
import type { Account, BalanceSnapshot, ReconciliationRecord, Transaction } from '../src/lib/etm/types.ts'
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
  account('Blue card', 'credit', 'CAD', 'Visa (...4242)', { mainCard: true }),
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
check('everything else is counted', dec.counted === 27, `${dec.counted}`)
check('income is summed', round(dec.income.CAD) === 6062.4, `${round(dec.income.CAD)}`)
check('spending is summed', round(dec.spend.CAD) === 3060.48, `${round(dec.spend.CAD)}`)
check('USD is kept apart from CAD', round(dec.spend.USD) === 30, `${round(dec.spend.USD)}`)
check('no transfer leaked into a total', round(dec.income.CAD) !== 6262.4 && round(dec.spend.CAD) !== 4270.48)

const EXPECTED_GROUP_SPEND: Array<[GroupId, number]> = [
  ['home', 1930],
  ['joy', 161.98],
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
  dec.byGroup.get('personal')?.categories.some((c) => c.label === 'Software' && c.spend.CAD === 0 && c.spend.USD === 30),
)

console.log('\n=== Reimbursables are held out of the budget ===')

// December holds three: two untagged beyond the marker, and one carrying two
// bucket tags at once.
check('they are counted apart', dec.reimbursable.count === 3, `${dec.reimbursable.count}`)
check('their total is kept', round(dec.reimbursable.spend.CAD) === 550, `${round(dec.reimbursable.spend.CAD)}`)
check('in their own currencies', round(dec.reimbursable.spend.USD) === 24, `${round(dec.reimbursable.spend.USD)}`)
check('none of it reached the budget', round(dec.spend.CAD) === 3060.48 && round(dec.spend.USD) === 30)
check(
  'the group they were charged to does not carry them',
  round(dec.byGroup.get('joy')?.spend.CAD ?? 0) === 161.98,
  `${round(dec.byGroup.get('joy')?.spend.CAD ?? 0)}`,
)
check(
  'a reimbursable category vanishes from the comparison entirely',
  !dec.categories.some((c) => c.label === 'Airfare'),
)
check(
  'a category with one of each keeps only the budget row',
  dec.categories.find((c) => c.label === 'Software')?.count === 1,
  `${dec.categories.find((c) => c.label === 'Software')?.count}`,
)

check('the tie-out holds in CAD', round(dec.totalOut.CAD) === 3610.48, `${round(dec.totalOut.CAD)}`)
check('the tie-out holds in USD', round(dec.totalOut.USD) === 54, `${round(dec.totalOut.USD)}`)

const BUCKETS = dec.reimbursable.buckets
check('several tags become one bucket', BUCKETS[0]?.label === 'Chris Personal + Healthcare', BUCKETS[0]?.label)
check('a bucket keeps its own subtotal', round(BUCKETS[0]?.spend.CAD ?? 0) === 140)
check('untagged reimbursables gather, and sort last', BUCKETS.at(-1)?.label === 'No bucket' && BUCKETS.at(-1)?.count === 2)
check(
  'the buckets add back up to the total',
  round(BUCKETS.reduce((s, b) => s + b.spend.CAD, 0)) === round(dec.reimbursable.spend.CAD) &&
    BUCKETS.reduce((s, b) => s + b.count, 0) === dec.reimbursable.count,
)

check('the marker is matched however it is typed', isReimbursable({ tags: ['  reimbursABLE '] } as never, 'Reimbursable'))
check(
  'a sub-tag alone is enough',
  isReimbursable({ tags: ['Reimbursable: Healthcare Account'] } as never, 'Reimbursable'),
)
check(
  'spacing around the colon is ignored',
  isReimbursable({ tags: ['reimbursable :  annual fees account'] } as never, 'Reimbursable'),
)
check('an unrelated tag is not', !isReimbursable({ tags: ['Travel'] } as never, 'Reimbursable'))
check('a bucket never includes the marker itself', !BUCKETS.some((b) => b.tags.some((t) => t.toLowerCase() === 'reimbursable')))
check(
  'the bucket is the name after the colon',
  bucketOf({ tags: ['Reimbursable: Eric Condo Costs'] } as never, 'Reimbursable').join() ===
    'Eric Condo Costs',
)
check(
  'the older parent-plus-name tagging still buckets the name',
  bucketOf({ tags: ['Reimbursable', 'Alex'] } as never, 'Reimbursable').join() === 'Alex',
)

const subOnly = tx('sub-only', '2025-12-19', 'acct-everyday', -50, {
  tags: ['Reimbursable: Healthcare Account'],
  category: 'Pharmacy',
  groupId: 'health',
})
const withSubTag = aggregate([...all, subOnly], december)
check(
  'a Reimbursable: … tag holds the row out without the parent',
  withSubTag.reimbursable.count === dec.reimbursable.count + 1,
  `${withSubTag.reimbursable.count}`,
)
check(
  'and the bucket is named for the account',
  withSubTag.reimbursable.buckets.some((b) => b.label === 'Healthcare Account' && b.count === 1),
  withSubTag.reimbursable.buckets.map((b) => b.label).join(', '),
)

// The tag is the user's to choose, so nothing may assume the default.
const renamed = aggregate(all, december, { reimbursableTag: 'Healthcare' })
check('a different tag moves the line', renamed.reimbursable.count === 1, `${renamed.reimbursable.count}`)
check('and the default stops being special', round(renamed.spend.CAD) === 3470.48, `${round(renamed.spend.CAD)}`)
check(
  'the bucket is then whatever else is there',
  renamed.reimbursable.buckets[0]?.label === 'Chris Personal + Reimbursable',
  renamed.reimbursable.buckets[0]?.label,
)

check(
  'a period with none of them ties out trivially',
  isEmpty(aggregate(all, monthPeriod('2025-04')).reimbursable.spend) &&
    round(aggregate(all, monthPeriod('2025-04')).totalOut.CAD) ===
      round(aggregate(all, monthPeriod('2025-04')).spend.CAD),
)

console.log('\n=== What the dashboard is handed ===')

// The dashboard's group modal lists these without any ETM code of its own,
// so the shape it receives is worth pinning down.
const handed = dashboardActuals(dec, 'December 2025')
check('the period is named for the dashboard', handed.label === 'December 2025')
check('group totals survive the handover', round(handed.byGroup.get('home')?.CAD ?? 0) === 1930)

const homeCategories = handed.categoriesByGroup.get('home') ?? []
const EXPECTED_HOME: Array<[string, number, number]> = [
  ['Rent', 1650, 1],
  ['Utilities', 140, 1],
  ['Internet', 85, 1],
  ['Phone', 55, 1],
]
check('a group arrives broken into its categories', homeCategories.length === 4, `${homeCategories.length}`)
for (const [name, spend, count] of EXPECTED_HOME) {
  const found = homeCategories.find((c) => c.name === name)
  check(`${name} is ${spend} over ${count}`, round(found?.spend.CAD ?? 0) === spend && found?.count === count, `${round(found?.spend.CAD ?? 0)}`)
}
check(
  'the categories add back up to the group',
  round(homeCategories.reduce((s, c) => s + c.spend.CAD, 0)) === 1930,
)
check(
  'categories are ordered largest first',
  homeCategories.map((c) => c.name).join(' ') === 'Rent Utilities Internet Phone',
)
check(
  'a USD-only category keeps its own currency across the handover',
  handed.categoriesByGroup.get('personal')?.some((c) => c.name === 'Software' && c.spend.CAD === 0 && c.spend.USD === 30),
)
check(
  'reimbursables are named for the dashboard, never folded in',
  round(handed.reimbursable.CAD) === 550 && round(handed.spend.CAD) === 3060.48,
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
check('USD rides alongside, never added in', round(monthly.actualTotal.USD) === 30)

const twoMonths = compareToBudget(plan, aggregate(all, rangePeriod('2025-11-01', '2025-12-31')))
check('two months of plan is twice the plan', twoMonths.plannedTotal === 4200, `${twoMonths.plannedTotal}`)
check('the plan scales but the actuals do not', round(twoMonths.actualTotal.CAD) > round(monthly.actualTotal.CAD))

console.log('\n=== Filtering the transactions view ===')

const base = noFilters()
// Thirty, not the twenty-seven the budget counted: this view hides nothing,
// so the three reimbursables are here.
check('by default the period alone applies', filterTransactions(all, december, base).length === 30)
check('internal rows can be brought back', filterTransactions(all, december, { ...base, includeInternal: true }).length === 34)

const groceriesOnly = filterTransactions(all, december, { ...base, categories: ['Groceries'] })
check('by category', groceriesOnly.length === 2 && round(-sumOf(groceriesOnly).CAD) === 345)

const foodOnly = filterTransactions(all, december, { ...base, groupIds: ['food'] })
check('by group', foodOnly.length === 6, `${foodOnly.length}`)

const usdOnly = filterTransactions(all, december, { ...base, accountIds: [usdAccount.id] })
check('by account', usdOnly.length === 2 && usdOnly.every((t) => t.currency === 'USD'), `${usdOnly.length}`)

const tagged = filterTransactions(all, year.period, { ...base, tags: ['Reimbursable'] })
check('by tag', tagged.length === 8, `${tagged.length}`)

const owned = filterTransactions(all, year.period, { ...base, owners: ['Sam'] })
check('by owner', owned.length === 4, `${owned.length}`)

// Ten, because the floor is on size and so catches the paycheque too.
const large = filterTransactions(all, december, { ...base, minAmount: 100 })
check('by amount floor', large.every((t) => Math.abs(t.amount) >= 100) && large.length === 10, `${large.length}`)

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

// ---------------------------------------------------------------------------
// The monthly workflow
// ---------------------------------------------------------------------------

console.log('\n=== Monthly savings ===')

// Hand calculation: 4,200 in the chequing account, 500 of it left as float,
// 1,300 owed on the card and 250 charged but not yet posted.
// 4200 − 500 − 1300 − 250 = 2150.
const workflowAccounts: Account[] = [
  account('Everyday', 'chequing', 'CAD', 'Chequing', { funding: true, float: 500 }),
  account('Aeroplan', 'credit', 'CAD', 'Visa', { mainCard: true }),
  account('Rainy day', 'savings', 'CAD', 'Savings', { savingsDestination: true }),
]
const balances: BalanceSnapshot[] = [
  balance('acct-everyday', '2025-12-31', 4200),
  balance('acct-aeroplan', '2025-12-31', 1300, 250),
]

const savings = computeSavings(workflowAccounts, balances, '2025-12-31')
check('the savings figure is cash less float less what is owed', round(savings.total.CAD) === 2150, `${round(savings.total.CAD)}`)
check('it is built from named parts, not a bare number', savings.parts.length === 4, `${savings.parts.length}`)
check('nothing is missing when every balance is in', savings.missing.length === 0)
check(
  'the savings destination is not part of the sum',
  !savings.parts.some((p) => p.accountId === 'acct-rainy-day'),
)

// A card balance is what is owed, so it subtracts however the user signs it.
const signed = computeSavings(workflowAccounts, [
  balance('acct-everyday', '2025-12-31', 4200),
  balance('acct-aeroplan', '2025-12-31', -1300, 250),
], '2025-12-31')
check('a card balance typed negative still subtracts', round(signed.total.CAD) === 2150, `${round(signed.total.CAD)}`)

const short = computeSavings(workflowAccounts, [
  balance('acct-everyday', '2025-12-31', 900),
  balance('acct-aeroplan', '2025-12-31', 1300),
], '2025-12-31')
check('a shortfall comes out negative rather than clamped', round(short.total.CAD) === -900, `${round(short.total.CAD)}`)

const absent = computeSavings(workflowAccounts, [balance('acct-everyday', '2025-12-31', 4200)], '2025-12-31')
check('an account with no balance is named', absent.missing.join(',') === 'Aeroplan', absent.missing.join(','))
check('and the figure says so rather than quietly reading zero', absent.parts.some((p) => p.missing))

// Currencies never meet (§7): a USD card owes USD, and no rate exists to
// turn that into the CAD figure.
const usdCard = [...workflowAccounts, account('Travel', 'credit', 'USD', 'US Card', { mainCard: true })]
const twoCurrencies = computeSavings(usdCard, [...balances, balance('acct-travel', '2025-12-31', 300)], '2025-12-31')
check('a USD card produces its own figure', round(twoCurrencies.total.USD) === -300, `${round(twoCurrencies.total.USD)}`)
check('and leaves the CAD one alone', round(twoCurrencies.total.CAD) === 2150)

check(
  'a stale balance is used but dated, so it can be seen to be stale',
  latestSnapshot([balance('acct-everyday', '2025-10-31', 10)], 'acct-everyday', '2025-12-31')?.date === '2025-10-31',
)
check(
  'a balance from after the date is not used',
  latestSnapshot([balance('acct-everyday', '2026-01-15', 10)], 'acct-everyday', '2025-12-31') === undefined,
)

console.log('\n=== Reimbursement pivot ===')

const pivot = reimbursementPivot(all, '2025-12', DEFAULT_CONFIG)
check('one row per bucket per currency', pivot.length === 3, `${pivot.length}`)
check('largest first', round(pivot[0]!.amount) === 410 && pivot[0]!.bucket === 'No bucket', `${round(pivot[0]!.amount)}`)
check('a bucket keeps its own currency', pivot.some((r) => r.currency === 'USD' && round(r.amount) === 24))
check(
  'the pivot agrees with the reimbursable totals',
  round(pivot.filter((r) => r.currency === 'CAD').reduce((s, r) => s + r.amount, 0)) === round(dec.reimbursable.spend.CAD),
)
check(
  'a card kept out of the family budget still appears here',
  pivot.some((r) => r.currency === 'USD'),
)
check('every row can be opened onto its transactions', pivot.every((r) => r.transactionIds.length === r.count))
check('an unconfigured bucket still shows, with nobody named', pivot.every((r) => r.owedBy === ''))

const named = withBucketSetting(DEFAULT_CONFIG, {
  bucket: 'Chris Personal + Healthcare',
  owedBy: 'Chris',
  displayName: 'Chris — physio',
})
const namedPivot = reimbursementPivot(all, '2025-12', named)
const chrisRow = namedPivot.find((r) => r.bucket === 'Chris Personal + Healthcare')
check('configuration names who owes', chrisRow?.owedBy === 'Chris', chrisRow?.owedBy)
check('and can rename the row without changing the tags', chrisRow?.label === 'Chris — physio', chrisRow?.label)
check('the amount is untouched by naming it', round(chrisRow?.amount ?? 0) === 140)
check(
  'clearing a setting removes it rather than storing a blank',
  withBucketSetting(named, { bucket: 'Chris Personal + Healthcare', owedBy: '', displayName: '' }).buckets.length === 0,
)

const settled = reimbursementPivot(all, '2025-12', named, {
  settled: [{ bucket: 'No bucket', currency: 'CAD' }],
})
check('a recorded transfer marks its row', settled.filter((r) => r.settled).length === 1)

console.log('\n=== Reconciliation ===')

// Hand calculation, one account at a time.
const recAccounts: Account[] = [
  account('Everyday', 'chequing', 'CAD', 'Chequing', { funding: true }),
  account('Aeroplan', 'credit', 'CAD', 'Visa', { mainCard: true }),
]
const recRows: Transaction[] = [
  tx('r1', '2025-12-05', 'acct-everyday', -300),
  tx('r2', '2025-12-20', 'acct-everyday', 800),
  // A transfer changes no spending but very much changes a balance.
  tx('r3', '2025-12-28', 'acct-everyday', -200, { internal: true }),
  tx('r4', '2025-12-09', 'acct-aeroplan', -450),
]
// Chequing: 1,000 → 1,300 is +300, and the rows come to −300 + 800 − 200 = +300.
// Card: owed 200 → owed 650 is +450 owed, which is −450 in the rows' language.
const recBalances: BalanceSnapshot[] = [
  balance('acct-everyday', '2025-11-30', 1000),
  balance('acct-everyday', '2025-12-31', 1300),
  balance('acct-aeroplan', '2025-11-30', 200),
  balance('acct-aeroplan', '2025-12-31', 650),
]

const rec = reconcile(recRows, recAccounts, recBalances, '2025-12', 5)
check('a month that adds up is balanced', rec.balanced)
check('with no residual left over', round(rec.residual.CAD) === 0, `${round(rec.residual.CAD)}`)
check('a transfer counts toward the balance it moved', round(byAccount(rec, 'acct-everyday').flow) === 300)
check(
  'a rising card balance reads as spending, not income',
  round(byAccount(rec, 'acct-aeroplan').observed ?? 0) === -450,
  `${round(byAccount(rec, 'acct-aeroplan').observed ?? 0)}`,
)
check('both accounts were anchored', rec.accounts.every((a) => a.anchored))
check('nothing is offered as unexplained when nothing is off', rec.unexplained.length === 0)

// The month opens where the last one closed, so one balance a month is enough.
check('the opening balance chains from the previous close', byAccount(rec, 'acct-everyday').opening?.date === '2025-11-30')
check('the day before a month start is the previous month end', dayBefore('2025-12-01') === '2025-11-30')
check('and across a year boundary', dayBefore('2025-01-01') === '2024-12-31')
check('and across a leap day', dayBefore('2024-03-01') === '2024-02-29')

// Forty dollars that no row explains.
const off = reconcile(recRows, recAccounts, [
  ...recBalances.filter((b) => b.accountId !== 'acct-everyday' || b.date !== '2025-12-31'),
  balance('acct-everyday', '2025-12-31', 1340),
], '2025-12', 5)
check('a gap the rows do not explain is caught', !off.balanced)
check('and reported to the cent', round(off.residual.CAD) === 40, `${round(off.residual.CAD)}`)
check('on the account it is in', !byAccount(off, 'acct-everyday').withinTolerance && byAccount(off, 'acct-aeroplan').withinTolerance)
check(
  'the rows to chase are that account\u2019s, largest first',
  off.unexplained.length === 3 && off.unexplained[0]!.id === 'r2',
  off.unexplained.map((t) => t.id).join(','),
)

const tolerated = reconcile(recRows, recAccounts, [
  ...recBalances.filter((b) => b.accountId !== 'acct-everyday' || b.date !== '2025-12-31'),
  balance('acct-everyday', '2025-12-31', 1303),
], '2025-12', 5)
check('a few dollars either way still closes', tolerated.balanced)
check('but the residual is still shown, not swallowed', round(tolerated.residual.CAD) === 3)

const unanchored = reconcile(recRows, recAccounts, [balance('acct-everyday', '2025-11-30', 1000)], '2025-12', 5)
check('an account with no closing balance is named, not ignored', unanchored.notAnchored.join(',') === 'Everyday,Aeroplan', unanchored.notAnchored.join(','))
check('and does not block the month from closing', unanchored.balanced)

console.log('\n=== Typical-month spend kept at close ===')

const closePlan: Budget = {
  ...plan,
  expenses: [
    { id: 'e1', name: 'Rent', groupId: 'home', amount: 1600 },
    { id: 'e2', name: 'Groceries', groupId: 'food', amount: 400.55 },
  ],
  goals: [{ id: 'g1', name: 'Vacation', kind: 'savings', monthly: 200, target: 5000, current: 0, annualRate: 0 }],
}
check('the kept figure is expense spend, not goals', planSpendAtClose(closePlan) === 2000.55)

const openRecord: ReconciliationRecord = {
  month: '2026-08',
  status: 'open',
  settled: [],
  residual: { CAD: 0, USD: 0 },
  notes: '',
}
check('an open month does not keep a plan', withPlanAtClose(openRecord, closePlan).plannedSpend === undefined)

const firstClose = withPlanAtClose({ ...openRecord, status: 'reconciled' }, closePlan)
check('the first close keeps today’s typical-month spend', firstClose.plannedSpend === 2000.55)

const laterBudget: Budget = {
  ...closePlan,
  expenses: [{ id: 'e1', name: 'Rent', groupId: 'home', amount: 2500 }],
}
check(
  'a later slider change does not rewrite a kept plan',
  withPlanAtClose(firstClose, laterBudget).plannedSpend === 2000.55,
)

const trend = closedPlanTrend(
  [
    firstClose,
    { ...openRecord, month: '2026-07', status: 'reconciled' },
    { ...firstClose, month: '2026-09', plannedSpend: 2100 },
    { ...openRecord, month: '2026-06' },
  ],
  (month) => (month === '2026-08' ? 1890.1 : 2200),
)
check('the trend is closed months that have a kept plan, oldest first', trend.map((row) => row.month).join(',') === '2026-08,2026-09')
check('August actual sits beside the kept plan', trend[0]?.planned === 2000.55 && trend[0]?.actual === 1890.1)

console.log('\n=== Statement CSVs (balances only) ===')

const bankStatement = `2025-12-01,OPENING,,,1000.00
2025-12-05,GREEN BASKET MARKET,165.00,,835.00
2025-12-20,NORTHWIND LABS,,800.00,1635.00`
const bank = parseStatementCsv(bankStatement)
check('the closing balance is the latest date', bank.balance === 1635 && bank.date === '2025-12-20', `${bank.balance} on ${bank.date}`)
check('every row is counted', bank.rows === 3)
check('and the first date is reported', bank.firstDate === '2025-12-01')

// Card exports write MM/DD/YYYY, and often newest first.
const cardStatement = `12/29/2025,SKYWAY AIR,410.00,,650.00
12/09/2025,HARBOUR RAIL,52.00,,240.00
12/01/2025,PAYMENT THANK YOU,,800.00,188.00`
const card = parseStatementCsv(cardStatement)
check('a card date is read as month first', card.date === '2025-12-29', card.date)
check('a newest-first file still closes on the latest date', card.balance === 650, `${card.balance}`)

check('an unambiguous day-first date is not thrown away', parseStatementDate('13/01/2025') === '2025-01-13', parseStatementDate('13/01/2025'))
check('a two-digit year is taken as this century', parseStatementDate('12/29/25') === '2025-12-29')
check('an impossible date is refused', parseStatementDate('13/13/2025') === '')

check(
  'headings are tolerated',
  parseStatementCsv('Date,Description,Debit,Credit,Balance\n2025-12-31,X,,,42.00').balance === 42,
)
check('money is read through symbols and brackets', parseStatementCsv('2025-12-31,X,,,"$1,234.56"').balance === 1234.56)
check('a file with nothing readable is refused', throwsSync(() => parseStatementCsv('nothing here at all')))
check('an empty file is refused', throwsSync(() => parseStatementCsv('')))
check(
  'the refusal explains the shape expected',
  refusalMentions('nothing here at all', 'running balance'),
)

console.log('\n=== Tidying up ===')

const untidy = findUntidy(all, accounts, '2025-12', DEFAULT_CONFIG)
check('nothing in the fixture is uncategorized', untidy.uncategorized.length === 0, `${untidy.uncategorized.length}`)
check(
  'generic parent-only tags are offered for a specific sub-tag',
  untidy.parentOnly.length === 3,
  `${untidy.parentOnly.length}`,
)
check(
  'an untagged purchase on a reimbursement-only card is offered',
  untidy.untaggedCandidates.length === 1 && untidy.untaggedCandidates[0]!.merchant === 'Cloudline Software',
  untidy.untaggedCandidates.map((t) => t.merchant).join(','),
)

// A business account is kept out of the family budget too, and nothing on it
// is ever claimed back. Asking about its every expense would be noise forever.
const business = account('Photography', 'chequing', 'CAD', 'Business', { excludedFromBudget: true })
const businessRows = [
  ...all,
  tx('biz1', '2025-12-04', business.id, -3.95, { category: 'Bank Fees', groupId: 'personal' }),
  tx('biz2', '2025-12-11', business.id, -220, { category: 'Software', groupId: 'personal' }),
]
const withBusiness = findUntidy(businessRows, [...accounts, business], '2025-12', DEFAULT_CONFIG)
check(
  'an excluded account that never claims anything is left alone',
  !withBusiness.untaggedCandidates.some((t) => t.accountId === business.id),
  withBusiness.untaggedCandidates.map((t) => t.merchant).join(','),
)
check(
  'while an account that does claim is still asked about',
  withBusiness.untaggedCandidates.length === 1,
  `${withBusiness.untaggedCandidates.length}`,
)

const claimed = findUntidy(
  [...businessRows, tx('biz3', '2025-11-20', business.id, -60, { tags: ['Reimbursable: Photography'] })],
  [...accounts, business],
  '2025-12',
  DEFAULT_CONFIG,
)
check(
  'one claim on the account is enough to start asking, even from another month',
  claimed.untaggedCandidates.filter((t) => t.accountId === business.id).length === 2,
  `${claimed.untaggedCandidates.filter((t) => t.accountId === business.id).length}`,
)

const withUncategorized = findUntidy(
  [...all, tx('u1', '2025-12-02', 'acct-everyday', -12, { category: 'Uncategorized' })],
  accounts,
  '2025-12',
  DEFAULT_CONFIG,
)
check('an uncategorized row is surfaced', withUncategorized.uncategorized.length === 1)

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)

function byAccount(reconciliation: Reconciliation, accountId: string) {
  return reconciliation.accounts.find((a) => a.accountId === accountId)!
}

function balance(accountId: string, date: string, amount: number, pending?: number): BalanceSnapshot {
  return {
    id: `bal-${accountId}-${date}`,
    accountId,
    date,
    balance: amount,
    ...(pending === undefined ? {} : { pending }),
    source: 'manual',
  }
}

function tx(
  id: string,
  date: string,
  accountId: string,
  amount: number,
  extra: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    date,
    merchant: id,
    originalStatement: '',
    notes: '',
    amount,
    currency: 'CAD',
    accountId,
    monarchAccount: '',
    category: 'Groceries',
    groupId: 'food',
    internal: false,
    tags: [],
    owner: '',
    reviewed: true,
    source: 'monarch',
    importBatchId: 'b1',
    ...extra,
  }
}

function throwsSync(work: () => unknown): boolean {
  try {
    work()
    return false
  } catch {
    return true
  }
}

function refusalMentions(text: string, phrase: string): boolean {
  try {
    parseStatementCsv(text)
    return false
  } catch (err) {
    return err instanceof StatementFormatError && err.message.includes(phrase)
  }
}

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
    mainCard: false,
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
