/**
 * Checks for the TD feed: the downloader's combined file, TD row identity and
 * dedup, the ledger's cutover rule, split expansion, and download progress.
 * Usage: npm run check:td
 *
 * Fixtures in scripts/fixtures/td/ are invented — no real account, number or
 * amount appears anywhere here.
 */
import { readFileSync } from 'node:fs'
import { planTdImport } from '../src/lib/etm/importer.ts'
import { counts, ledgerView, shadowRows } from '../src/lib/etm/ledger.ts'
import { parseStatementCsv } from '../src/lib/etm/statement.ts'
import { downloadProgress, matchStatementFiles, scanStatementNames } from '../src/lib/etm/statementFolder.ts'
import {
  TdFileError,
  isCombinedFileName,
  newestCombined,
  parseTdCombinedCsv,
  pseudoFileName,
} from '../src/lib/etm/td.ts'
import type { Account, Transaction } from '../src/lib/etm/types.ts'

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

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)
