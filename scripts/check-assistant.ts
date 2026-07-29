/** Shows which local intent a question matches, and the answer it produces. */
import { readFileSync } from 'node:fs'
import { localAnswer } from '../src/lib/assistant.ts'
import { parseBudgetCsv } from '../src/lib/csv.ts'
import type { Budget } from '../src/lib/types.ts'

const parsed = parseBudgetCsv(readFileSync('public/sample/ted-budget.csv', 'utf8'))
const budget: Budget = {
  version: 1,
  profile: { name: 'Ted', housing: 'rent', household: 'single', dependents: 0, hasDebt: false, region: 'Calgary' },
  income: parsed.income,
  expenses: parsed.expenses,
  goals: parsed.goals,
  updatedAt: new Date().toISOString(),
  source: 'sample',
}

const questions = process.argv.slice(2)
for (const q of questions) {
  console.log(`\n### ${q}\n`)
  console.log(localAnswer(q, budget))
}

console.log('\n### flexible lines it can draw on\n')
for (const l of budget.expenses.filter((e) => !e.essential).sort((a, z) => z.amount - a.amount))
  console.log(` ${String(l.amount).padStart(6)}  ${l.name}`)
