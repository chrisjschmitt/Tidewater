/**
 * Back-test of the rules engine on a real Monarch export, kept outside the
 * repo: learn from everything before a cut-off date, categorize the rows after
 * it as if they had arrived from TD, and compare with how they were filed.
 *
 * Usage: npm run backtest:rules -- /path/to/monarch-export.csv [cutoff YYYY-MM-DD] [settings.json]
 *
 * settings.json (optional) holds RuleSettings fields such as categoryMerges and
 * retiredTags — the same choices made in the app. Nothing is written anywhere.
 */
import { readFileSync } from 'node:fs'
import { parseMonarchCsv } from '../src/lib/etm/monarch.ts'
import { categorize } from '../src/lib/etm/rules/engine.ts'
import { buildModel, cleanLabel, isInternal, type HistoryRow } from '../src/lib/etm/rules/model.ts'
import { collapse } from '../src/lib/etm/rules/normalize.ts'
import { withRuleDefaults } from '../src/lib/etm/rules/types.ts'
import type { Account } from '../src/lib/etm/types.ts'

const [path, cutoffArg, settingsPath] = process.argv.slice(2)
if (!path) {
  console.log('Usage: npm run backtest:rules -- /path/to/monarch-export.csv [cutoff YYYY-MM-DD] [settings.json]')
  process.exit(0)
}
const cutoff = cutoffArg ?? new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
const settings = withRuleDefaults(settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : undefined)
const reimbursableTag = 'Reimbursable'

const { rows } = parseMonarchCsv(readFileSync(path, 'utf8'))
const accounts = new Map<string, Account>()
const accountFor = (name: string): Account => {
  const found = accounts.get(name)
  if (found) return found
  const lastFour = /\(\.\.\.(\d{4})\)/.exec(name)?.[1] ?? ''
  const account: Account = {
    id: `acct-${accounts.size}`,
    nickname: name,
    kind: /VISA|CARD \(/i.test(name) ? 'credit' : 'chequing',
    currency: 'CAD',
    lastFour,
    monarchName: name,
    funding: false,
    mainCard: false,
    savingsDestination: false,
    excludedFromBudget: false,
  }
  accounts.set(name, account)
  return account
}

const history: HistoryRow[] = rows
  .filter((row) => row.originalStatement)
  .map((row) => {
    const account = accountFor(row.account)
    return {
      date: row.date,
      accountId: account.id,
      card: account.kind === 'credit',
      statement: row.originalStatement,
      merchant: row.merchant,
      category: row.category,
      tags: row.tags,
      amount: row.amount,
    }
  })

const train = history.filter((row) => row.date < cutoff)
const test = history.filter((row) => row.date >= cutoff)
const model = buildModel(train, settings, { asOf: cutoff, reimbursableTag })
const ctx = { model, settings, accounts: [...accounts.values()], reimbursableTag }
const ownerBuckets = model.ownerBuckets

// The test rows, grouped the way TD would deliver them: one row per purchase.
const groups = new Map<string, HistoryRow[]>()
for (const row of test) {
  const id = `${row.date}|${row.accountId}|${collapse(row.statement).toUpperCase()}`
  groups.set(id, [...(groups.get(id) ?? []), row])
}

const tally = { correct: 0, wrong: 0, splitNeeded: 0, reviewRight: 0, review: 0 }
const byLayer = new Map<string, number>()
let total = 0
const bankEq = (category: string) => (category === 'Credit Card Payment' ? 'Transfer' : category)

for (const group of groups.values()) {
  const labels = group.map((row) => cleanLabel(row, settings, reimbursableTag, ownerBuckets))
  if (labels.some((label) => !label)) continue
  const split = new Set(labels.map((label) => label!.category)).size > 1
  const units = split ? [group] : group.map((row) => [row])
  for (const unit of units) {
    total++
    const first = unit[0]!
    const account = [...accounts.values()].find((a) => a.id === first.accountId)!
    const amount = Math.round(unit.reduce((sum, row) => sum + row.amount, 0) * 100) / 100
    const truth = [...new Set(unit.map((row) => cleanLabel(row, settings, reimbursableTag, ownerBuckets)!.category))].sort()
    const result = categorize({ date: first.date, description: first.statement, amount, account }, ctx)
    byLayer.set(result.layer, (byLayer.get(result.layer) ?? 0) + 1)
    const show = process.env.SHOW
    if (show && (!result.outcome ? show.includes('review') : false)) console.log('  R', first.date, first.statement.slice(0, 28).padEnd(28), amount, '| truth', truth.join('+'), '| sugg', result.suggestions.map((s) => s.category).join(', '), '|', result.reasons.join('; '))
    if (!result.outcome) {
      if (result.suggestions[0] && truth.length === 1 && result.suggestions[0].category === truth[0]) tally.reviewRight++
      else tally.review++
      continue
    }
    const got = [...new Set((result.outcome.split ?? [result.outcome]).map((line) => line.category))].sort()
    const same =
      got.join('|') === truth.join('|') ||
      (!account || account.kind !== 'credit'
        ? got.map(bankEq).join('|') === truth.map(bankEq).join('|')
        : false)
    if (same) tally.correct++
    else if (split && got.some((c) => truth.includes(c))) tally.splitNeeded++
    else {
      tally.wrong++
      if (process.env.SHOW?.includes('wrong')) console.log('  W', first.date, first.statement.slice(0, 28).padEnd(28), amount, '| truth', truth.join('+'), '| got', got.join('+'), `(${result.layer})`)
    }
  }
}

const pct = (n: number) => `${Math.round((n / total) * 100)}%`
console.log(`Learned from ${train.length} rows before ${cutoff}; tested ${total} transactions after it.`)
console.log(`  auto, correct          ${tally.correct}  ${pct(tally.correct)}`)
console.log(`  auto, wrong            ${tally.wrong}  ${pct(tally.wrong)}`)
console.log(`  right, but was split   ${tally.splitNeeded}  ${pct(tally.splitNeeded)}`)
console.log(`  review, suggestion ok  ${tally.reviewRight}  ${pct(tally.reviewRight)}`)
console.log(`  review                 ${tally.review}  ${pct(tally.review)}`)
console.log(`  by layer: ${[...byLayer].map(([layer, n]) => `${layer} ${n}`).join(', ')}`)
console.log(`  owner buckets found: ${[...ownerBuckets.values()].join(', ') || 'none'}`)
console.log(`  split templates: ${model.templates.size}; internal check: ${isInternal('Transfer')}`)
