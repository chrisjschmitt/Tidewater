/**
 * Local-only walk-forward of the forecasting engine against a Monarch export.
 * Usage: npm run backtest:forecast -- /path/to/export.csv
 *
 * Prints aggregates only. Never writes into the repo. The path is required —
 * there is no default, so a personal iCloud export cannot be picked up by
 * accident.
 */
import { readFileSync } from 'node:fs'
import { groupForCategory, isInternalCategory } from '../src/lib/categories.ts'
import { walkForward } from '../src/lib/forecast/backtest.ts'
import { forecast } from '../src/lib/forecast/forecast.ts'
import { withForecastDefaults } from '../src/lib/forecast/types.ts'
import { splitUniverse } from '../src/lib/forecast/universe.ts'
import { parseMonarchCsv, type MonarchRow } from '../src/lib/etm/monarch.ts'
import type { Currency, Transaction } from '../src/lib/etm/types.ts'
import type { Budget } from '../src/lib/types.ts'

const path = process.argv[2]
if (!path || path.startsWith('-')) {
  console.error('Usage: npm run backtest:forecast -- /path/to/monarch-export.csv')
  process.exit(2)
}

const text = readFileSync(path, 'utf8')
const { rows, skipped } = parseMonarchCsv(text)

function toTransactions(parsed: MonarchRow[]): Transaction[] {
  return parsed.map((row, i) => {
    const usd = /usd|us dollar|us card/i.test(row.account)
    return {
      id: `bt-${i}`,
      date: row.date,
      merchant: row.merchant,
      originalStatement: row.originalStatement,
      notes: row.notes,
      amount: row.amount,
      currency: (usd ? 'USD' : 'CAD') as Currency,
      accountId: usd ? 'usd' : 'cad',
      monarchAccount: row.account,
      category: row.category,
      groupId: groupForCategory(row.category),
      internal: isInternalCategory(row.category),
      tags: row.tags,
      owner: row.owner,
      reviewed: row.reviewed,
      source: 'monarch' as const,
      importBatchId: 'backtest',
    }
  })
}

const transactions = toTransactions(rows)
const last = [...transactions].sort((a, z) => a.date.localeCompare(z.date)).at(-1)?.date ?? new Date().toISOString().slice(0, 10)
const asOf = last
const config = withForecastDefaults({ window: 12 })
const budget: Budget = {
  version: 1,
  profile: { name: 'local', housing: 'other', household: 'single', dependents: 0, hasDebt: false, region: '' },
  income: [{ id: 'i', name: 'Income', amount: 0 }],
  expenses: [],
  goals: [],
  updatedAt: asOf,
  source: 'transactions',
}

const split = splitUniverse(transactions, config)
const twelve = forecast(transactions, budget, config, asOf)
const twentyFour = forecast(transactions, budget, withForecastDefaults({ window: 24 }), asOf)
const walked = walkForward(transactions, budget, config, asOf)

const counts = (result: typeof twelve) => {
  const tally: Record<string, number> = {}
  for (const category of result.cad.household.categories) {
    tally[category.type] = (tally[category.type] ?? 0) + 1
  }
  return tally
}

console.log('rows read', rows.length, 'skipped', skipped)
console.log('series', {
  household: split.household.length,
  vacation: split.vacation.length,
  excluded: split.excluded.length,
  dropped: split.dropped.length,
})
console.log('window 12 set-aside', twelve.cad.household.setAside.likely, twelve.windowLabel)
console.log('window 24 set-aside', twentyFour.cad.household.setAside.likely, twentyFour.windowLabel)
console.log('classification counts (12)', counts(twelve))
console.log('classification counts (24)', counts(twentyFour))
console.log('high set-aside P90', twelve.cad.household.setAside.high)
console.log('coverage', twelve.coverage.coverage, 'of', twelve.coverage.coverageTarget)
console.log(
  'walk-forward month errors',
  walked.months.map((m) => ({ month: m.month, error: Math.round(m.error) })),
)
console.log(
  'walk-forward MAE by type',
  Object.fromEntries(Object.entries(walked.byType).map(([type, row]) => [type, { mae: Math.round(row.mae), months: row.months }])),
)
