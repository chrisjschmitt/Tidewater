/**
 * Checks for the TD feed: the downloader's combined file, TD row identity and
 * dedup, the ledger's cutover rule, split expansion, and download progress.
 * Usage: npm run check:td
 *
 * Fixtures in scripts/fixtures/td/ are invented — no real account, number or
 * amount appears anywhere here.
 */
import { readFileSync } from 'node:fs'
import { findPossibleDuplicates, pairKey } from '../src/lib/etm/duplicates.ts'
import { evaluateAmount } from '../src/lib/etm/calc.ts'
import { aggregate } from '../src/lib/etm/aggregate.ts'
import { monthPeriod } from '../src/lib/etm/period.ts'
import { countsAsBudgetSpend, settleRow } from '../src/lib/etm/review.ts'
import { planTdImport } from '../src/lib/etm/importer.ts'
import { budgetDateOf, counts, ledgerView, shadowRows } from '../src/lib/etm/ledger.ts'
import { dailyCompare } from '../src/lib/etm/dailyCompare.ts'
import { isPendingFileName, newestPending, parsePendingFile, pendingRows } from '../src/lib/etm/pending.ts'
import { uncategorized } from '../src/lib/etm/importer.ts'
import { parseStatementCsv } from '../src/lib/etm/statement.ts'
import { downloadProgress, matchStatementFiles, reviewRows, scanStatementNames, snapshotFor } from '../src/lib/etm/statementFolder.ts'
import {
  TdFileError,
  isCombinedFileName,
  newestCombined,
  parseTdCombinedCsv,
  pseudoFileName,
} from '../src/lib/etm/td.ts'
import type { Account, Transaction } from '../src/lib/etm/types.ts'
import { budgetAt, budgetOver, planAmountAt, withPlanChange } from '../src/lib/forecast/planHistory.ts'
import type { Budget } from '../src/lib/types.ts'

let failures = 0
function check(label: string, passed: boolean, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!passed) failures++
}

const fixture = (name: string) => readFileSync(`scripts/fixtures/td/${name}`, 'utf8')

function account(nickname: string, kind: Account['kind'], lastFour: string, extra: Partial<Account> = {}): Account {
  return {
    id: `acct-${lastFour}`,
    nickname,
    kind,
    currency: 'CAD',
    lastFour,
    monarchName: `${nickname} (...${lastFour})`,
    funding: false,
    mainCard: false,
    savingsDestination: false,
    excludedFromBudget: false,
    ...extra,
  }
}

const chequing = account('Everyday Chequing', 'chequing', '1111', { funding: true })
const visa = account('Rewards Visa', 'credit', '2222', { mainCard: true })
const accounts = [chequing, visa]

console.log('=== Combined file ===')
const first = parseTdCombinedCsv(fixture('TD-transactions-2026-10-05.csv'))
check('one block per account', first.length === 3, `${first.length}`)
const cheq = first.find((b) => b.lastFour === '1111')!
const card = first.find((b) => b.lastFour === '2222')!
check('bank debit is negative', cheq.rows[0]!.amount === -3.95)
check('bank credit is positive', cheq.rows.find((r) => r.description === 'PAYROLL DEP')!.amount === 1500)
check('card purchase is negative', card.rows[0]!.amount === -82.4)
check('card payment is positive', card.rows.find((r) => r.description.startsWith('PAYMENT'))!.amount === 500)
check('quoted description with comma survives', cheq.rows[3]!.description === 'COFFEE SHOP, MAIN ST')
check('whitespace collapsed', !/\s{2}/.test(cheq.rows[3]!.description))
check('running balance kept', cheq.rows[0]!.balance === 1996.05)
let refused = false
try {
  parseTdCombinedCsv('Date,Description,Amount\n2026-09-01,X,1\n')
} catch (err) {
  refused = err instanceof TdFileError
}
check('a file without the combined header is refused', refused)

console.log('=== File names ===')
check('combined name recognised', isCombinedFileName('TD-transactions-2026-10-05.csv'))
check('per-account name is not combined', !isCombinedFileName('TD-everyday-chequing-1111-2026-10-05.csv'))
check(
  'newest combined wins',
  newestCombined(['TD-transactions-2026-10-05.csv', 'TD-transactions-2026-10-06.csv', 'x.csv'])?.date === '2026-10-06',
)
check(
  'scan of per-account files ignores the combined file',
  scanStatementNames(['TD-transactions-2026-10-05.csv', 'TD-everyday-chequing-1111-2026-10-05.csv']).files.length === 1 &&
    scanStatementNames(['TD-transactions-2026-10-05.csv']).skipped.length === 0,
)

console.log('=== Closing balances from the combined file ===')
const pseudo = first.map((b) => pseudoFileName(b, '2026-10-05'))
const match = matchStatementFiles(accounts, pseudo)
check('blocks match accounts by last four', match.byAccount.get(chequing.id)?.lastFour === '1111' && match.byAccount.get(visa.id)?.lastFour === '2222')
check('a block for an unregistered account is unmatched', match.unmatched.length === 1 && match.unmatched[0]!.lastFour === '3333')
const cheqReading = parseStatementCsv(cheq.asStatementText)
check('bank closing balance is the last row by date', cheqReading.balance === 3237.05 && cheqReading.date === '2026-09-04', `${cheqReading.balance}`)
const cardReading = parseStatementCsv(card.asStatementText)
check('card closing balance from newest-first rows', cardReading.balance === 682.4 && cardReading.date === '2026-09-25', `${cardReading.balance}`)

const sameDay = parseStatementCsv(
  ['10/05/2026,SHOP A,62.15,,472.32,', '10/05/2026,SHOP B,68.75,,410.17,', '10/05/2026,PAYMENT,,3051.33,341.42,', '10/04/2026,SHOP C,15.26,,3392.75,'].join('\n'),
)
check('newest-first card, several rows on the last day: the first of them closes', sameDay.balance === 472.32, `${sameDay.balance}`)
const sameDayBank = parseStatementCsv(['2026-10-04,A,1,,100', '2026-10-05,B,2,,98', '2026-10-05,C,3,,95'].join('\n'))
check('oldest-first bank, several rows on the last day: the last of them closes', sameDayBank.balance === 95, `${sameDayBank.balance}`)
check('trailing empty column on card lines is not taken as the balance', sameDay.rows === 4)
const oneDayCard = parseStatementCsv(
  ['10/05/2026,SHOP A,62.15,,472.32,', '10/05/2026,SHOP B,68.75,,410.17,', '10/05/2026,PAYMENT,,3051.33,341.42,'].join('\n'),
)
check('every row on one day: the running balances decide the order', oneDayCard.balance === 472.32, `${oneDayCard.balance}`)
const oneDayBank = parseStatementCsv(['2026-10-05,A,1,,99', '2026-10-05,B,,10,109', '2026-10-05,C,4,,105'].join('\n'))
check('every row on one day, oldest first: the last row closes', oneDayBank.balance === 105, `${oneDayBank.balance}`)

console.log('=== TD import plan and dedup ===')
const plan1 = await planTdImport(first, {
  fileName: 'TD-transactions-2026-10-05.csv',
  fileDate: '2026-10-05',
  accounts,
  existing: new Map(),
})
check('rows of matched accounts are added', plan1.added.length === 8, `${plan1.added.length}`)
check('unregistered account reported, not imported', plan1.unmatched.length === 1 && plan1.unmatchedBlocks.length === 1)
const coffee = plan1.added.filter((t) => t.originalStatement === 'COFFEE SHOP, MAIN ST')
check('two identical same-day rows stay two rows', coffee.length === 2 && coffee[0]!.id !== coffee[1]!.id)
check('rows arrive as the TD source, uncategorized, unreviewed', plan1.added.every((t) => t.source === 'td' && t.category === 'Uncategorized' && !t.reviewed))
check('prediction recorded', plan1.added.every((t) => t.prediction?.layer === 'review'))

const stored = new Map(plan1.added.map((t) => [t.id, t]))
const second = parseTdCombinedCsv(fixture('TD-transactions-2026-10-06.csv'))
const plan2 = await planTdImport(second, {
  fileName: 'TD-transactions-2026-10-06.csv',
  fileDate: '2026-10-06',
  accounts,
  existing: stored,
})
check('overlapping download: known rows unchanged', plan2.unchanged === 2, `${plan2.unchanged}`)
check('overlapping download: only new rows added', plan2.added.length === 2, `${plan2.added.length}`)

// A categorized row is never revised by a later download.
const edited = { ...coffee[0]!, category: 'Restaurants & Bars', reviewed: true }
const plan3 = await planTdImport(second, {
  fileName: 'TD-transactions-2026-10-06.csv',
  fileDate: '2026-10-06',
  accounts,
  existing: new Map([...stored, [edited.id, edited]]),
})
check('re-import leaves a categorized row alone', plan3.updated.length === 0)

console.log('=== Ledger and cutover ===')
const monarchRow: Transaction = {
  ...plan1.added[0]!,
  id: 'm1',
  source: 'monarch',
  category: 'Financial Fees',
  monarchAccount: 'Everyday Chequing (...1111)',
}
const tdRow = plan1.added[0]!
const manual: Transaction = { ...tdRow, id: 'cash1', source: 'manual' }
const all = [monarchRow, tdRow, manual]
const none = ledgerView(all, undefined)
check('no cutover: Monarch and manual count, TD is shadow', none.length === 2 && !none.some((t) => t.source === 'td'))
check('no cutover: TD row listed as shadow', shadowRows(all, undefined).length === 1)
const cut = { perAccount: { [chequing.id]: '2026-09-01' } }
const after = ledgerView(all, cut)
check('after cutover: TD and manual count, Monarch does not', after.length === 2 && !after.some((t) => t.source === 'monarch'))
check('cutover is per account', counts({ ...monarchRow, accountId: visa.id }, cut))
check('global cutover applies where no account date is set', !counts({ ...monarchRow, accountId: visa.id }, { global: '2026-09-01', perAccount: {} }))
check('rows before the cutover date still come from Monarch', counts({ ...monarchRow, date: '2026-08-31' }, cut))

console.log('=== Switch-over edges ===')
const base = (id: string, source: Transaction['source'], date: string, accountId = chequing.id): Transaction => ({
  ...tdRow, id, source, date, accountId, originalStatement: 'HARDWARE STORE', amount: -42, split: undefined,
})
const octSwitch = { global: '2026-10-01', perAccount: {} }
const otherBank: Transaction = { ...base('costco', 'monarch', '2026-10-03', 'acct-otherbank'), originalStatement: '' }
const edge = [
  base('m-early', 'monarch', '2026-09-30'),
  base('t-late', 'td', '2026-10-01'),
  { ...base('m-late', 'monarch', '2026-10-02'), originalStatement: 'GARDEN CENTRE', amount: -15 },
  { ...base('t-early', 'td', '2026-09-30'), originalStatement: 'GARDEN CENTRE', amount: -15 },
  otherBank,
]
const counted = new Set(ledgerView(edge, octSwitch).map((t) => t.id))
check('a purchase dated either side by the two feeds counts once — TD side, when TD is on or after the date', counted.has('t-late') && !counted.has('m-early'))
check('… and the Monarch side, when TD dates it before the switch-over', counted.has('m-late') && !counted.has('t-early'))
check('an account with no TD feed stays on Monarch after a global switch-over', counted.has('costco'))

console.log('=== TD vs Monarch, day by day ===')
{
  const r = (id: string, source: Transaction['source'], date: string, text: string, amount: number, category: string, accountId = chequing.id): Transaction => ({
    ...base(id, source, date, accountId), originalStatement: text, amount, category, internal: category === 'Transfer', tags: [],
  })
  const rows = [
    r('mA', 'monarch', '2026-11-03', 'FOOD STORE', -50, 'Groceries'),
    r('tA', 'td', '2026-11-03', 'FOOD STORE', -50, 'Groceries'),
    r('mP', 'monarch', '2026-11-04', 'CAFE', -20, 'Restaurants & Bars'),
    r('mF', 'monarch', '2026-11-02', 'CHQ', -252.08, 'Trailer park fees'),
    r('tF', 'td', '2026-11-02', 'CHQ', -252.08, 'Transfer'),
    r('mX', 'monarch', '2026-10-31', 'ATM W/D', -100, 'Cash for spending'),
    r('tX', 'td', '2026-11-02', 'ATM W/D', -100, 'Cash for spending'),
    r('hand', 'manual', '2026-11-03', 'MARKET', -10, 'Groceries'),
    { ...r('cc', 'monarch', '2026-11-03', '', -30, 'Groceries', 'acct-otherbank') },
  ]
  const days = dailyCompare(rows, { period: monthPeriod('2026-11'), accounts, reimbursableTag: 'Reimbursable' })
  const total = (side: 'monarchSpend' | 'tdSpend') => Math.round(days.reduce((s, d) => s + d[side], 0) * 100) / 100
  check('Monarch side adds up as Monarch would count the month', total('monarchSpend') === 362.08, `${total('monarchSpend')}`)
  check('TD side adds up as TD would count the month', total('tdSpend') === 190, `${total('tdSpend')}`)
  const nov2 = days.find((d) => d.date === '2026-11-02')!
  check('a purchase dated Oct 31 by Monarch and Nov 2 by TD lines up on Nov 2, Monarch counting it in October',
    nov2.lines.some((l) => l.kind === 'paired' && l.monarch[0]?.id === 'mX' && l.monarchSpend === 0 && l.tdSpend === 100))
  check('filed differently shows as a pair with different spend', nov2.lines.some((l) => l.kind === 'paired' && l.monarchSpend === 252.08 && l.tdSpend === 0))
  const nov4 = days.find((d) => d.date === '2026-11-04')!
  check('a Monarch row TD lacks (pending) is Monarch only', nov4.lines.length === 1 && nov4.lines[0]!.kind === 'monarchOnly')
  const nov3 = days.find((d) => d.date === '2026-11-03')!
  check('hand-entered and no-TD-feed rows are shared, same on both sides', nov3.lines.filter((l) => l.kind === 'shared').length === 2 && nov3.monarchSpend === nov3.tdSpend)
}

console.log('=== Pending card charges ===')
{
  check('pending file name recognised', isPendingFileName('TD-pending-2026-11-04.json') && !isPendingFileName('TD-transactions-2026-11-04.csv'))
  check('newest pending file wins', newestPending(['TD-pending-2026-11-01.json', 'TD-pending-2026-11-04.json', 'x.csv'])?.date === '2026-11-04')
  const file = JSON.stringify({
    date: '2026-11-04',
    accounts: [
      { label: 'Visa', lastFour: '2222', readAt: '2026-11-04T23:10:00Z', total: 80.5, charges: [
        { date: '2026-11-03', description: 'BOOK SHOP', amount: -30 },
        { date: '2026-11-04', description: 'CAFE', amount: -50.5 },
      ] },
      { label: 'Not ours', lastFour: '9999', readAt: '2026-11-04T23:10:00Z', total: 5, charges: [] },
    ],
  })
  const snap = parsePendingFile(file, 'TD-pending-2026-11-04.json', accounts)!
  check('pending file read, unknown cards left out', snap.accounts.length === 1 && snap.accounts[0]!.charges.length === 2)
  check('not a pending file → null', parsePendingFile('nope', 'x.json', accounts) === null)
  const switched = { global: '2026-11-01', perAccount: {} }
  const tdVisa = (id: string, date: string, amount: number, feedFile: string): Transaction => ({
    ...base(id, 'td', date, visa.id), amount, originalStatement: 'BOOK SHOP', feedFile, category: 'Books', internal: false,
  })
  const stored = [tdVisa('v1', '2026-11-02', -12, 'TD-transactions-2026-11-04.csv')]
  const rows = pendingRows(snap, stored, { accounts, cutover: switched, categorize: uncategorized })
  check('pending charges become budget rows after the switch-over', rows.length === 2 && rows.every((r) => r.pending && r.id.startsWith('pending|')))
  check('… signed as charges', rows.reduce((s, r) => s + r.amount, 0) === -80.5)
  check('before the switch-over they do not count', pendingRows(snap, stored, { accounts, categorize: uncategorized }).length === 0)
  const posted = [...stored, tdVisa('v2', '2026-11-05', -30, 'TD-transactions-2026-11-04.csv')]
  check('a charge drops away once its posted copy is in', pendingRows(snap, posted, { accounts, cutover: switched, categorize: uncategorized }).length === 1)
  const later = [...stored, tdVisa('v3', '2026-11-06', -7, 'TD-transactions-2026-11-07.csv')]
  check('a later download without a fresh reading makes it stale', pendingRows(snap, later, { accounts, cutover: switched, categorize: uncategorized }).length === 0)
}

console.log('=== Splits ===')
const splitRow: Transaction = {
  ...tdRow,
  id: 's1',
  amount: -100,
  split: [
    { amount: -60, category: 'Restaurants & Bars', tags: [] },
    { amount: -40, category: 'Gifts', tags: ['Reimbursable: Other'] },
  ],
}
const parts = ledgerView([splitRow], { global: '2026-01-01', perAccount: {} })
check('split row replaced by its parts', parts.length === 2 && parts[0]!.id === 's1#1')
check('parts sum to the row', Math.round(parts.reduce((s, t) => s + t.amount, 0) * 100) / 100 === -100)
check('parts carry their own category and group', parts[1]!.category === 'Gifts' && parts[1]!.groupId === 'joy', parts[1]!.groupId)
check('parts are marked as parts of a split', parts[0]!.splitOf?.part === 1 && parts[1]!.splitOf?.parts === 2 && parts[1]!.splitOf?.parentId === 's1')
const commented = ledgerView([{ ...splitRow, notes: 'whole', split: [{ ...splitRow.split![0]!, notes: 'mine' }, splitRow.split![1]!] }], { global: '2026-01-01', perAccount: {} })
check('a part’s own comment wins; others show the row’s', commented[0]!.notes === 'mine' && commented[1]!.notes === 'whole')

console.log('=== Carrying a balance forward ===')
const septFile = { name: 'TD-transactions-2026-10-07.csv', labelSlug: 'rewards-visa', lastFour: '2222', date: '2026-10-07' }
const quietRead = new Map([[visa.id, { file: septFile, reading: { date: '2026-09-29', balance: 427.26, rows: 3, firstDate: '2026-09-15' } }]])
const quiet = reviewRows(accounts, quietRead, '2026-10', { balances: [], downloadDate: '2026-10-07' }).find((r) => r.account.id === visa.id)!
check('no transactions this month: carried forward, not left outside the month', quiet.carriedFrom === '2026-09-29' && quiet.asOf === '2026-10-07' && !quiet.outsideMonth)
check('carried balance is recorded inside the month', snapshotFor(quiet, 'b1')?.date === '2026-10-07' && snapshotFor(quiet, 'b1')?.balance === 427.26)
const lastMonth = reviewRows(accounts, quietRead, '2026-09', { balances: [] }).find((r) => r.account.id === visa.id)!
check('a row inside the month is recorded as itself', !lastMonth.carriedFrom && lastMonth.reading?.date === '2026-09-29')
const absent = reviewRows(accounts, new Map(), '2026-10', {
  balances: [{ id: 'old', accountId: chequing.id, date: '2026-09-30', balance: 1234.5, source: 'statement' }],
  downloadDate: '2026-10-07',
  fileName: 'TD-transactions-2026-10-07.csv',
}).find((r) => r.account.id === chequing.id)!
check('missing from the file: last recorded balance carried forward', absent.carriedFrom === '2026-09-30' && absent.balance === 1234.5 && snapshotFor(absent, 'b2')?.date === '2026-10-07')
const noHistory = reviewRows(accounts, new Map(), '2026-10', { balances: [], downloadDate: '2026-10-07' }).find((r) => r.account.id === chequing.id)!
check('missing and nothing recorded before: nothing invented', !noHistory.reading && !noHistory.carriedFrom)
const lateMonth = reviewRows(accounts, quietRead, '2026-11', { balances: [], downloadDate: '2026-10-07' }).find((r) => r.account.id === visa.id)!
check('a download from before the month carries nothing into it', !lateMonth.carriedFrom && lateMonth.outsideMonth === true)

console.log('=== A month closed on its own last row ===')
// TD dates weekend activity on a bank account with the next business day, and
// its running balance already includes it: October closes before those rows.
const weekend = parseStatementCsv(
  [
    '2026-10-30,INSURANCE,63.82,,1000.00',
    '2026-10-30,FEE,3.75,,996.25',
    '2026-11-02,TFR-FR SAVINGS,,150.00,1146.25',
    '2026-11-02,NON-TD ATM W/D,104.50,,1041.75',
  ].join('\n'),
)
check('the file’s closing balance is its last row', weekend.date === '2026-11-02' && weekend.balance === 1041.75)
const weekendFile = { name: 'TD-transactions-2026-10-31.csv', labelSlug: 'everyday', lastFour: '1111', date: '2026-10-31' }
const octClose = reviewRows(accounts, new Map([[chequing.id, { file: weekendFile, reading: weekend }]]), '2026-10', {
  balances: [],
  downloadDate: '2026-10-31',
}).find((r) => r.account.id === chequing.id)!
check(
  'October closes on its last row, before the rows TD dated Nov 2',
  octClose.balance === 996.25 && octClose.reading?.date === '2026-10-30' && !octClose.outsideMonth,
  `${octClose.balance} ${octClose.reading?.date}`,
)
check('and says how many rows it left for November', octClose.heldBack?.rows === 2 && octClose.heldBack.firstDate === '2026-11-02')
check('it is recorded as October’s balance', snapshotFor(octClose, 'b3')?.date === '2026-10-30' && snapshotFor(octClose, 'b3')?.balance === 996.25)
const novClose = reviewRows(accounts, new Map([[chequing.id, { file: weekendFile, reading: weekend }]]), '2026-11', { balances: [] }).find(
  (r) => r.account.id === chequing.id,
)!
check('November takes the whole file', novClose.balance === 1041.75 && !novClose.heldBack)
const weekendCard = reviewRows(accounts, new Map([[visa.id, { file: weekendFile, reading: weekend }]]), '2026-10', { balances: [] }).find(
  (r) => r.account.id === visa.id,
)!
check(
  'a card file whose balances chain closes the month on its last row in it too',
  weekend.chained === true && weekendCard.balance === 996.25 && weekendCard.heldBack?.rows === 2 && !weekendCard.outsideMonth,
  JSON.stringify({ chained: weekend.chained, balance: weekendCard.balance, heldBack: weekendCard.heldBack }),
)
// Two exports joined badly: the running balance jumps where they meet.
const brokenCard = parseStatementCsv(
  [
    '11/02/2026,FOOD BASICS,94.12,,1200.00',
    '10/31/2026,FRESHCO,11.74,,980.00',
    '10/30/2026,LE MOULIN,13.79,,968.26',
    '10/29/2026,SHOPPERS,22.59,,954.47',
  ].join('\n'),
)
const brokenRow = reviewRows(accounts, new Map([[visa.id, { file: weekendFile, reading: brokenCard }]]), '2026-10', { balances: [] }).find(
  (r) => r.account.id === visa.id,
)!
check('a card file whose balances don’t chain still warns instead', brokenCard.chained === false && brokenRow.outsideMonth === true && !brokenRow.heldBack)

console.log('=== Editing and the budget running total ===')
const mk = (id: string, amount: number, category: string, extra: Partial<Transaction> = {}): Transaction => ({
  ...tdRow, id, date: '2026-10-03', amount, category, tags: [], internal: category === 'Transfer', split: undefined, ...extra,
})
const sample = [
  mk('g', -80, 'Groceries'),
  mk('r', 20, 'Groceries'),
  mk('x', -500, 'Transfer'),
  mk('i', 1500, 'Paycheck'),
  mk('rb', -0.5, 'Financial Fees', { tags: ['Reimbursable: Sam Personal'] }),
  mk('ex', -40, 'Dining', { accountId: 'acct-excluded' }),
]
const accts = [...accounts, { ...chequing, id: 'acct-excluded', excludedFromBudget: true }]
const budgetSpend = aggregate(sample, monthPeriod('2026-10'), { excludeAccountIds: new Set(['acct-excluded']), reimbursableTag: 'Reimbursable' }).spend.CAD
const runningSpend = sample.filter((t) => countsAsBudgetSpend(t, 'Reimbursable', accts)).reduce((s, t) => s - t.amount, 0)
check('running total counts exactly what the Budget tab counts', Math.round(runningSpend * 100) === Math.round(budgetSpend * 100), `${runningSpend} vs ${budgetSpend}`)
const tagged = settleRow(mk('fee', -0.5, 'Financial Fees'), { merchant: 'TD', notes: 'paid for Sam', lines: [{ amount: -0.5, category: 'Financial Fees', tags: ['Reimbursable: Sam Personal'] }] })
check('editing a row sets tags, comment and confirms it', tagged.tags[0] === 'Reimbursable: Sam Personal' && tagged.notes === 'paid for Sam' && tagged.reviewed && tagged.prediction?.layer === 'manual')
const splitEdit = settleRow(mk('sp', -100, 'Uncategorized'), { merchant: 'Store', lines: [{ amount: -70, category: 'Groceries', tags: [] }, { amount: -30, category: 'Gifts', tags: [] }] })
check('a split edit names the row by its largest part', splitEdit.category === 'Groceries' && splitEdit.split?.length === 2)
const unsplit = settleRow(splitEdit, { merchant: 'Store', lines: [{ amount: -100, category: 'Groceries', tags: [] }] })
check('one line clears the split', !unsplit.split)

console.log('=== Month cut-off and count-in dates ===')
const cutoffs = { '2026-09': '2026-09-29' }
check('after an early close, the 30th counts from the 1st of next month', budgetDateOf({ date: '2026-09-30' }, cutoffs) === '2026-10-01')
check('on or before the close it stays put', budgetDateOf({ date: '2026-09-29' }, cutoffs) === '2026-09-29')
check('a December close rolls into January', budgetDateOf({ date: '2026-12-31' }, { '2026-12': '2026-12-30' }) === '2027-01-01')
check('a row’s own count-in date wins over the cut-off', budgetDateOf({ date: '2026-09-30', budgetDate: '2026-09-30' }, cutoffs) === '2026-09-30')
const moved = ledgerView([{ ...tdRow, id: 'late', source: 'manual', date: '2026-09-30', split: undefined }], undefined, undefined, { cutoffs })
check('the ledger counts it on the new date and keeps the bank date', moved[0]!.date === '2026-10-01' && moved[0]!.bankDate === '2026-09-30')
check('September loses it, October gains it', aggregate(moved, monthPeriod('2026-09')).spend.CAD === 0 && aggregate(moved, monthPeriod('2026-10')).spend.CAD > 0)

console.log('=== Amount fields that calculate ===')
check('price plus 13% HST', evaluateAmount('=9.95+13%') === 11.24)
check('three items added', evaluateAmount('=9.95+5.95+1.95') === 17.85)
check('a plain number still reads', evaluateAmount('12.50') === 12.5)
check('brackets and times', evaluateAmount('=(9.95+5.95)*1.13') === 17.97)
check('a discount', evaluateAmount('=20-10%') === 18)
check('a percent of an amount', evaluateAmount('=50*13%') === 6.5)
check('thirds round to cents', evaluateAmount('=100/3') === 33.33)
check('dollar signs, commas and spaces are ignored', evaluateAmount('= $1,234.50 + 1') === 1235.5)
check('anything unreadable is refused, never run', [ '=1+', 'abc', '=2*(3', '=1/0', 'alert(1)' ].every((x) => evaluateAmount(x) === null))
console.log('=== Possible duplicates ===')
const dupe = (id: string, date: string, amount: number, feedFile: string): Transaction => ({
  ...tdRow, id, date, amount, feedFile, originalStatement: 'BISTRO 21', split: undefined, duplicateOf: undefined,
})
const redated = [dupe('d1', '2026-10-03', -45, 'TD-transactions-2026-10-04.csv'), dupe('d2', '2026-10-05', -45, 'TD-transactions-2026-10-10.csv')]
check('same charge re-dated in a later download is flagged', findPossibleDuplicates(redated).length === 1)
check('two identical charges in one download are not', findPossibleDuplicates([dupe('s1', '2026-10-03', -5, 'f1'), dupe('s2', '2026-10-03', -5, 'f1')]).length === 0)
const tipped = findPossibleDuplicates([dupe('t1', '2026-10-03', -45, 'f1'), dupe('t2', '2026-10-04', -54, 'f2')])
check('a tip added when it posted is flagged as an amount change', tipped.length === 1 && !tipped[0]!.sameAmount)
check('a very different amount is not', findPossibleDuplicates([dupe('v1', '2026-10-03', -45, 'f1'), dupe('v2', '2026-10-04', -120, 'f2')]).length === 0)
check('more than three days apart is not', findPossibleDuplicates([dupe('w1', '2026-10-01', -45, 'f1'), dupe('w2', '2026-10-06', -45, 'f2')]).length === 0)
check('“not a duplicate” is remembered', findPossibleDuplicates(redated, [pairKey('d1', 'd2')]).length === 0)
const typed: Transaction = { ...dupe('m1', '2026-10-09', -123.45, ''), source: 'manual', merchant: 'Costco', originalStatement: '' }
const imported: Transaction = { ...dupe('c1', '2026-10-10', -123.45, ''), source: 'monarch', merchant: 'Costco Wholesale', originalStatement: '' }
const twice = findPossibleDuplicates([typed, imported], [], new Set(['m1', 'c1']))
check('a hand-entered purchase that Monarch also imported is flagged', twice.length === 1 && twice[0]!.kind === 'hand' && twice[0]!.a.id === 'm1')
check('not when the amounts differ', findPossibleDuplicates([typed, { ...imported, amount: -123.4 }], [], new Set(['m1', 'c1'])).length === 0)
check('not against a row that does not count (a TD shadow row)', findPossibleDuplicates([typed, { ...imported, source: 'td' }], [], new Set(['m1'])).length === 0)
check('not once the hand-entered copy is marked a duplicate', findPossibleDuplicates([{ ...typed, duplicateOf: 'c1' }, imported], [], new Set(['c1'])).length === 0)
const dropped = ledgerView([{ ...typed, duplicateOf: 'c1' }, imported], undefined)
check('keeping the Monarch copy leaves one counted', dropped.length === 1 && dropped[0]!.id === 'c1')
const kept = ledgerView([redated[0]!, { ...redated[1]!, duplicateOf: 'd1' }], { global: '2026-10-01', perAccount: {} })
check('a row marked as a duplicate never counts', kept.length === 1 && kept[0]!.id === 'd1')
check('and is not flagged again', findPossibleDuplicates([redated[0]!, { ...redated[1]!, duplicateOf: 'd1' }]).length === 0)

console.log('=== Download progress ===')
const day = '2026-10-07'
const p0 = downloadProgress(accounts, [], day)
check('nothing yet: every account waiting', p0.accounts.every((a) => a.state === 'waiting') && !p0.combined)
const p1 = downloadProgress(accounts, ['TD-everyday-chequing-1111-2026-10-07.csv', 'TD-rewards-visa-2222-2026-09-01.csv'], day)
check('today’s file ticks its account; an old file does not', p1.accounts.find((a) => a.account.id === chequing.id)?.state === 'downloaded' && p1.accounts.find((a) => a.account.id === visa.id)?.state === 'waiting')
const p2 = downloadProgress(
  accounts,
  ['TD-transactions-2026-10-07.csv', 'TD-everyday-chequing-1111-2026-10-07.csv', 'TD-rewards-visa-2222-2026-10-07.csv'],
  day,
)
check('files moved to raw/ still count, combined file ends the run', p2.accounts.every((a) => a.state === 'downloaded') && p2.combined === 'TD-transactions-2026-10-07.csv')

console.log('=== Plan from a month on ===')
const plan0: Budget = {
  income: [],
  expenses: [
    { id: 'e1', name: 'Groceries', groupId: 'food', amount: 800, essential: true },
    { id: 'e2', name: 'Dining', groupId: 'joy', amount: 200, essential: false },
  ],
  goals: [],
} as unknown as Budget
const oct = withPlanChange(plan0, undefined, { key: 'groceries', label: 'Groceries', month: '2026-10', amount: 900 })
check('the budget carries the new plan going forward', oct.budget.expenses[0]!.amount === 900)
check('months before keep the old plan', planAmountAt(oct.budget, oct.history, 'groceries', '2026-09') === 800)
check('the month itself and after use the new plan', planAmountAt(oct.budget, oct.history, 'groceries', '2026-10') === 900 && planAmountAt(oct.budget, oct.history, 'groceries', '2027-03') === 900)
check('other categories untouched', planAmountAt(oct.budget, oct.history, 'dining', '2026-09') === 200)
const dec = withPlanChange(oct.budget, oct.history, { key: 'groceries', label: 'Groceries', month: '2026-12', amount: 1000 })
check('a later change keeps every earlier month', planAmountAt(dec.budget, dec.history, 'groceries', '2026-09') === 800 && planAmountAt(dec.budget, dec.history, 'groceries', '2026-11') === 900 && planAmountAt(dec.budget, dec.history, 'groceries', '2026-12') === 1000)
const nov = withPlanChange(dec.budget, dec.history, { key: 'groceries', label: 'Groceries', month: '2026-11', amount: 850 })
check('an earlier change replaces what was set after it', planAmountAt(nov.budget, nov.history, 'groceries', '2026-10') === 900 && planAmountAt(nov.budget, nov.history, 'groceries', '2026-11') === 850 && planAmountAt(nov.budget, nov.history, 'groceries', '2027-01') === 850)
check('budgetAt rebuilds an earlier month', budgetAt(nov.budget, nov.history, '2026-09').expenses[0]!.amount === 800)
check('budgetOver averages a span so months × plan is the sum', budgetOver(oct.budget, oct.history, ['2026-09', '2026-10']).expenses[0]!.amount === 850)
const added = withPlanChange(plan0, undefined, { key: 'pet food', label: 'Pet food', month: '2026-10', amount: 50 })
check('a category with no plan line gets one, zero before', added.budget.expenses.length === 3 && planAmountAt(added.budget, added.history, 'pet food', '2026-09') === 0)
const same = withPlanChange(plan0, undefined, { key: 'dining', label: 'Dining', month: '2026-10', amount: 200 })
check('setting the same amount records nothing', Object.keys(same.history).length === 0)

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)
