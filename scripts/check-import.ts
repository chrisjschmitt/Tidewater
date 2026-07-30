/**
 * Sanity check for the CSV importers.
 * Usage: npm run check:import
 *
 * Always checks public sample budgets. Monarch transaction CSVs under Test-Data/
 * are optional (that folder is gitignored when it holds personal exports).
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseBudgetCsv, parseTransactionsCsv } from '../src/lib/csv.ts'
import { groupSummaries, totalExpenses, totalIncome, unallocated } from '../src/lib/budget.ts'
import { money } from '../src/lib/format.ts'
import type { Budget } from '../src/lib/types.ts'

const asBudget = (income: Budget['income'], expenses: Budget['expenses'], goals: Budget['goals'] = []): Budget => ({
  version: 1,
  profile: { name: '', housing: 'rent', household: 'single', dependents: 0, hasDebt: false, region: '' },
  income,
  expenses,
  goals,
  updatedAt: new Date().toISOString(),
  source: 'transactions',
})

function summarizeBudget(label: string, path: string) {
  console.log(`=== ${label} ===`)
  const parsed = parseBudgetCsv(readFileSync(path, 'utf8'))
  const budget = asBudget(parsed.income, parsed.expenses, parsed.goals)
  console.log('income     ', money(totalIncome(budget)))
  console.log('expenses   ', money(totalExpenses(budget)))
  console.log('goals      ', parsed.goals.map((g) => `${g.name} ${money(g.monthly)}/mo`).join(', ') || '(none)')
  console.log('unallocated', money(unallocated(budget)))
  console.log('warnings   ', parsed.warnings)
  console.log()
}

summarizeBudget('Ted sample budget', 'public/sample/ted-budget.csv')
summarizeBudget('Noel sample budget', 'public/sample/noel-budget.csv')

const monarchPath = 'Test-Data/Transactions_2026-07-29.csv'
console.log('=== Monarch transactions ===')
if (!existsSync(monarchPath)) {
  console.log(`Skipped — ${monarchPath} not found (Test-Data/ is local-only).`)
  process.exit(0)
}

const tx = parseTransactionsCsv(readFileSync(monarchPath, 'utf8'))
const txBudget = asBudget(tx.income, tx.expenses)
console.log(tx.note)
console.log('skipped internal transfers/payments:', tx.skippedInternal)
console.log('avg monthly income  ', money(totalIncome(txBudget)))
console.log('avg monthly spending', money(totalExpenses(txBudget)))
console.log('difference          ', money(totalIncome(txBudget) - totalExpenses(txBudget)))

console.log('\ntop income lines')
for (const l of tx.income.slice(0, 6)) console.log(' ', money(l.amount).padStart(10), l.name)

console.log('\nspending by group')
for (const g of groupSummaries(txBudget)) {
  console.log(' ', money(g.total).padStart(10), g.group.name.padEnd(22), g.lines.slice(0, 4).map((l) => l.name).join(', '))
}
