/**
 * Sanity check for the CSV importers, run against the real files in Test-Data.
 * Usage: npx tsx scripts/check-import.ts
 */
import { readFileSync } from 'node:fs'
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

console.log('=== Ted sample budget ===')
const ted = parseBudgetCsv(readFileSync('public/sample/ted-budget.csv', 'utf8'))
const tedBudget = asBudget(ted.income, ted.expenses, ted.goals)
console.log('income     ', money(totalIncome(tedBudget)))
console.log('expenses   ', money(totalExpenses(tedBudget)))
console.log('goals      ', ted.goals.map((g) => `${g.name} ${money(g.monthly)}/mo`).join(', '))
console.log('unallocated', money(unallocated(tedBudget)))
console.log('warnings   ', ted.warnings)

console.log('\n=== Monarch transactions ===')
const tx = parseTransactionsCsv(readFileSync('Test-Data/Transactions_2026-07-29.csv', 'utf8'))
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
