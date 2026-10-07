/**
 * Checks for the rules engine: statement keys, each layer, the guards, learned
 * splits, owner buckets, merges and retired tags, the TD↔Monarch matching, and
 * re-applying rules. Usage: npm run check:rules
 *
 * Every account, merchant and amount here is invented.
 */
import { reapplyPlan } from '../src/lib/etm/rules/apply.ts'
import { matchFeeds } from '../src/lib/etm/rules/compare.ts'
import { applyShape, categorize, type RuleContext } from '../src/lib/etm/rules/engine.ts'
import { buildModel, type HistoryRow } from '../src/lib/etm/rules/model.ts'
import { counterAccount, statementKey } from '../src/lib/etm/rules/normalize.ts'
import { withRuleDefaults, type RuleSettings } from '../src/lib/etm/rules/types.ts'
import type { Account, Transaction } from '../src/lib/etm/types.ts'

let failures = 0
function check(label: string, passed: boolean, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!passed) failures++
}

const account = (id: string, kind: Account['kind'], lastFour: string): Account => ({
  id,
  nickname: id,
  kind,
  currency: 'CAD',
  lastFour,
  monarchName: id,
  funding: false,
  mainCard: false,
  savingsDestination: false,
  excludedFromBudget: false,
})
const bank = account('bank', 'chequing', '1111')
const savings = account('savings', 'savings', '2222')
const card = account('card', 'credit', '3333')
const accounts = [bank, savings, card]

console.log('=== Statement keys ===')
check('store numbers and spacing drop out', statementKey('METRO  990') === statementKey('METRO 426') && statementKey('METRO 426') === 'METRO')
check('processor prefixes drop out', statementKey('SQ *CORNER CAFE') === 'CORNER CAFE')
check('order ids drop out', statementKey('AMZN Mktp CA*5A43K7E11') === 'AMZN MKTP CA')
check('transfer keeps its counter-account', statementKey('AB123 TFR-TO 7654321') === 'TFR-TO 7654321')
check('points transfer keeps its number', statementKey('PTS TO:  98765432101') === 'PTS TO 98765432101')
check('counter-account read', counterAccount('XY999 TFR-FR 5551111')?.number === '5551111' && counterAccount('XY999 TFR-FR 5551111')?.direction === 'FR')

console.log('=== Learning ===')
const h = (date: string, statement: string, category: string, amount: number, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  date,
  accountId: 'bank',
  card: false,
  statement,
  merchant: statement.split(' ')[0]!,
  category,
  tags: [],
  amount,
  ...extra,
})
const history: HistoryRow[] = [
  // An old convention, then a new one: recency wins.
  h('2025-01-05', 'BOOKSHOP', 'Books', -20, { accountId: 'card', card: true, tags: ['Reimbursable: Sam Personal'] }),
  h('2025-02-05', 'BOOKSHOP', 'Books', -20, { accountId: 'card', card: true, tags: ['Reimbursable: Sam Personal'] }),
  h('2026-07-05', 'BOOKSHOP', 'Sam personal', -20, { accountId: 'card', card: true, tags: ['Reimbursable: Sam Personal'] }),
  h('2026-08-05', 'BOOKSHOP', 'Sam personal', -20, { accountId: 'card', card: true, tags: ['Reimbursable: Sam Personal'] }),
  // Mixed history stays below the threshold.
  h('2026-06-01', 'DOLLAR STORE', 'Gifts', -5, { accountId: 'card', card: true }),
  h('2026-07-01', 'DOLLAR STORE', 'Shopping', -5, { accountId: 'card', card: true }),
  h('2026-08-01', 'DOLLAR STORE', 'Gifts', -5, { accountId: 'card', card: true }),
  h('2026-08-15', 'DOLLAR STORE', 'Shopping', -5, { accountId: 'card', card: true }),
  // A fixed-amount split, three months running (two Monarch rows each).
  ...['2026-06-02', '2026-07-02', '2026-08-03'].flatMap((d) => [
    h(d, 'CONDO CORP MSP', 'Condo Fees', -1000, { tags: ['Reimbursable: Tenant'] }),
    h(d, 'CONDO CORP MSP', 'Condo Fees', -100),
  ]),
  // A share split whose total changes.
  ...[['2026-06-10', -90], ['2026-07-10', -120], ['2026-08-10', -150]].flatMap(([d, total]) => [
    h(d as string, 'SATELLITE NET', 'Internet', (total as number) / 3),
    h(d as string, 'SATELLITE NET', 'Other Reimbursement', ((total as number) * 2) / 3, { tags: ['Reimbursable: Other'] }),
  ]),
  // Income, and an allowance transfer to an own account.
  h('2026-07-25', 'PENSION DEP', 'Pension', 900),
  h('2026-08-25', 'PENSION DEP', 'Pension', 900),
  h('2026-08-01', 'PTS TO:  00000001111', 'Allowance', -50),
  h('2026-07-01', 'PTS TO:  00000001111', 'Allowance', -50),
  h('2026-08-03', 'GROCER 12', 'Groceries', -80),
  h('2026-08-09', 'COFFEE HOUSE', 'Restaurants & Bars', -6),
  h('2026-08-11', 'OLD CAFE', 'Restaurants & Bars', -9, { tags: ['Old tag'] }),
  h('2026-08-12', 'PARKING LOT 3', 'Parking', -4),
  // Two pension deposits on one day, one per person: same text, told apart by amount.
  ...['2026-04-26', '2026-05-26', '2026-06-26'].map((d) => h(d, 'PENSION  PEN', 'Pension - A', 852.13)),
  ...['2026-07-27', '2026-08-27'].flatMap((d) => [h(d, 'PENSION  PEN', 'Pension - A', 852.13), h(d, 'PENSION  PEN', 'Pension - B', 1165.95)]),
]
const settings: RuleSettings = withRuleDefaults({
  categoryMerges: { Parking: 'Parking & Tolls' },
  retiredTags: ['Old tag'],
  dividendSources: [{ number: '7777777', minAmount: 5000, multiple: 1000, category: 'Dividend' }],
})
const model = buildModel(history, settings, { asOf: '2026-09-01', reimbursableTag: 'Reimbursable' })
const ctx: RuleContext = { model, settings, accounts, reimbursableTag: 'Reimbursable' }
const run = (description: string, amount: number, acct: Account = bank) =>
  categorize({ date: '2026-09-02', description, amount, account: acct }, ctx)

check('owner bucket found from a tag matching a category', model.ownerBuckets.get('reimbursable:sam personal') === 'Sam personal')
check('recent convention wins over old', run('BOOKSHOP', -25, card).outcome?.category === 'Sam personal')
check('owner tag kept on the outcome', run('BOOKSHOP', -25, card).outcome?.tags.includes('Reimbursable: Sam Personal') === true)
const mixed = run('DOLLAR STORE', -7, card)
check('mixed history goes to review with suggestions', mixed.layer === 'review' && mixed.suggestions.length === 2)
check('merged category learned under its new name', run('PARKING LOT 7', -3).outcome?.category === 'Parking & Tolls')
check('retired tag never produced', (run('OLD CAFE', -9).outcome?.tags ?? ['x']).length === 0)

console.log('=== Splits ===')
const condo = run('CONDO CORP MSP', -1100)
check('fixed split applied', condo.layer === 'template' && condo.outcome?.split?.length === 2)
check('fixed split amounts', condo.outcome?.split?.map((l) => l.amount ?? 0).sort((a, z) => a - z).join(',') === '-1000,-100')
const odd = run('CONDO CORP MSP', -2475)
check('an amount the fixed split does not fit goes to review', odd.layer === 'review')
const sat = run('SATELLITE NET', -180)
check('share split scales to the amount', sat.outcome?.split?.reduce((s, l) => s + (l.amount ?? 0), 0) === -180)
check('shape: rounding lands in the last line', applyShape([{ category: 'A', tags: [], share: 1 / 3 }, { category: 'B', tags: [], share: 2 / 3 }], -100)!.map((l) => l.amount).join(',') === '-33.33,-66.67')

console.log('=== Fixed layer and own accounts ===')
check('card payment credit', run('PAYMENT - THANK YOU', 500, card).outcome?.category === 'Credit Card Payment')
check('transfer to C/C', run('AB123 TFR-TO C/C', -200).outcome?.category === 'Credit Card Payment')
check('bank debit to another card', run('XBANK MC A1B2C3', -300).outcome?.category === 'Credit Card Payment')
check('learned allowance beats own-account transfer', run('PTS TO:  00000001111', -50).outcome?.category === 'Allowance')
check('unlearned transfer to an own account', run('CD456 TFR-TO 0002222', -75).outcome?.category === 'Transfer')
check('dividend: large round amount', run('EF789 TFR-FR 7777777', 10000).outcome?.category === 'Dividend')
check('dividend source: small odd amount is a repayment', run('EF789 TFR-FR 7777777', 105.46).outcome?.category === 'Transfer')
check('dividend source: round but small goes to review', run('EF789 TFR-FR 7777777', 3000).layer === 'review')

console.log('=== Keywords and guards ===')
check('keyword into a category history uses', run('NEW BISTRO', -40).outcome?.category === 'Restaurants & Bars')
check('no keyword into a category history lacks', run('GRAND HOTEL', -400).layer === 'review')
const drift = run('PENSION DEP', 2100)
check('income amount far from usual goes to review', drift.layer === 'review' && drift.reasons[0]!.includes('different amount'))
check('usual income settles', run('PENSION DEP', 900).outcome?.category === 'Pension')
const cardTransfer = categorize(
  { date: '2026-09-02', description: 'PTS TO:  00000001111', amount: -50, account: card },
  ctx,
)
check('a card purchase is never a transfer', cardTransfer.outcome?.category !== 'Transfer')
const always = categorize(
  { date: '2026-09-02', description: 'GROCER 15', amount: -50, account: bank },
  { ...ctx, settings: { ...settings, alwaysReview: ['GROCER'] } },
)
check('always-check merchant goes to review with the answer suggested', always.layer === 'review' && always.suggestions[0]?.category === 'Groceries')
const taught = categorize(
  { date: '2026-09-02', description: 'DOLLAR STORE', amount: -7, account: card },
  { ...ctx, settings: { ...settings, userRules: [{ id: 'r', key: 'DOLLAR STORE', outcome: { merchant: 'Dollar', category: 'Gifts', tags: [] }, createdAt: '' }] } },
)
check('a taught rule settles what history could not', taught.layer === 'user' && taught.outcome?.category === 'Gifts')

console.log('=== Filed by amount ===')
check('first person\'s deposit by its amount', run('PENSION PEN', 852.13).outcome?.category === 'Pension - A')
check('second person\'s deposit by its amount', run('PENSION PEN', 1165.95).outcome?.category === 'Pension - B')
check('a known amount is not flagged as unusual', run('PENSION PEN', 1165.95).layer !== 'review')
const amountRule = categorize(
  { date: '2026-09-02', description: 'CONDO CORP MSP', amount: -1100, account: bank },
  { ...ctx, settings: { ...settings, userRules: [
    { id: 'm', key: 'CONDO CORP MSP', outcome: { merchant: 'Condo', category: 'Housing', tags: [] }, createdAt: '' },
    { id: 'a', key: 'CONDO CORP MSP', amount: -1100, outcome: { merchant: 'Condo', category: 'Special assessment', tags: [] }, createdAt: '' },
  ] } },
)
check('a taught rule outranks a learned split', amountRule.layer === 'user')
check('a taught exact-amount rule outranks the merchant rule', amountRule.outcome?.category === 'Special assessment')

console.log('=== Trips ===')
const tripSettings: RuleSettings = {
  ...settings,
  trips: [{ id: 't', label: 'Spring trip', start: '2026-09-01', end: '2026-09-10' }],
  familyAccountIds: ['card'],
  tripTag: 'Reimbursable: Vacation',
  tripSkipCategories: ['Restaurants & Bars', 'Groceries'],
  tripRecategorize: { 'Parking & Tolls': 'Transportation' },
}
const onTrip = (description: string, amount: number, acct: Account = card, date = '2026-09-05') =>
  categorize({ date, description, amount, account: acct }, { ...ctx, settings: tripSettings })
check('trip: a new merchant gets the trip tag on review suggestions', onTrip('MUSEUM OF THINGS', -20).layer === 'review' && onTrip('MUSEUM OF THINGS', -20).reasons.some((r) => r.includes('Spring trip')))
check('trip: restaurants are not tagged', !(onTrip('NEW BISTRO', -40).outcome?.tags ?? []).includes('Reimbursable: Vacation'))
check('trip: re-filed category gets the tag', onTrip('PARKING LOT 9', -6).outcome?.category === 'Transportation' && onTrip('PARKING LOT 9', -6).outcome!.tags.includes('Reimbursable: Vacation'))
check('trip: a regular merchant is not trip spending', !(onTrip('BOOKSHOP', -20).outcome?.tags ?? []).includes('Reimbursable: Vacation'))
check('trip: an account outside the family is left alone', onTrip('PARKING LOT 9', -6, bank).outcome?.category === 'Parking & Tolls')
check('trip: outside the dates nothing changes', onTrip('PARKING LOT 9', -6, card, '2026-09-20').outcome?.category === 'Parking & Tolls')
check('trip: card payments untouched', onTrip('PAYMENT - THANK YOU', 300).outcome?.tags.length === 0)

console.log('=== Matching TD to Monarch ===')
const tx = (id: string, source: Transaction['source'], date: string, statement: string, amount: number, category: string): Transaction => ({
  id,
  date,
  merchant: statement,
  originalStatement: statement,
  notes: '',
  amount,
  currency: 'CAD',
  accountId: 'bank',
  monarchAccount: '',
  category,
  groupId: 'other',
  internal: false,
  tags: [],
  owner: '',
  reviewed: false,
  source,
  importBatchId: 'b',
})
const tdRows = [
  tx('t1', 'td', '2026-09-03', 'GROCER  12', -80, 'Groceries'),
  tx('t2', 'td', '2026-09-03', 'CONDO CORP MSP', -1100, 'Condo Fees'),
  tx('t3', 'td', '2026-09-04', 'NEW SHOP', -12, 'Uncategorized'),
]
const monarchRows = [
  tx('m1', 'monarch', '2026-09-05', 'GROCER 12', -80, 'Gifts'),
  tx('m2', 'monarch', '2026-09-03', 'CONDO CORP MSP', -1000, 'Condo Fees'),
  tx('m3', 'monarch', '2026-09-03', 'CONDO CORP MSP', -100, 'Condo Fees'),
  tx('m4', 'monarch', '2026-09-20', 'ONLY IN MONARCH', -5, 'Gifts'),
]
const compared = matchFeeds(tdRows, monarchRows, { accounts, model, settings, reimbursableTag: 'Reimbursable' })
check('same text, amount, two days apart: matched', compared.pairs.some((p) => p.td.id === 't1' && p.monarch[0]!.id === 'm1'))
check('disagreement noticed', compared.pairs.find((p) => p.td.id === 't1')?.agrees === false)
check('a Monarch split matches its TD total', compared.pairs.find((p) => p.td.id === 't2')?.monarch.length === 2)
check('unmatched on each side reported', compared.tdOnly.map((r) => r.id).join() === 't3' && compared.monarchOnly.map((r) => r.id).join() === 'm4')

console.log('=== Re-applying rules ===')
const stored = [
  tx('u1', 'td', '2026-09-03', 'GROCER 12', -80, 'Uncategorized'),
  { ...tx('u2', 'td', '2026-09-03', 'GROCER 12', -60, 'Gifts'), reviewed: true },
]
const plan = reapplyPlan(stored, accounts, ctx)
check('unconfirmed TD rows are re-categorized', plan.updated.length === 1 && plan.updated[0]!.next.category === 'Groceries')
check('confirmed rows are never touched', !plan.updated.some((u) => u.next.id === 'u2'))
check('the previous version is kept for undo', plan.updated[0]!.previous.category === 'Uncategorized')

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
if (failures > 0) process.exit(1)
