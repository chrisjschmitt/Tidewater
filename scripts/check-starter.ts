/**
 * Sanity check for the "start from scratch" budget generator.
 * Usage: node scripts/check-starter.ts (via esbuild bundle, see README)
 */
import { buildStarterBudget, EMPTY_ANSWERS } from '../src/lib/starter.ts'
import { groupSummaries, totalExpenses, totalIncome, unallocated } from '../src/lib/budget.ts'
import { money } from '../src/lib/format.ts'

const cases = [
  { label: 'Single renter, Calgary', answers: { ...EMPTY_ANSWERS, monthlyIncome: 5850, housing: 'rent' as const, housingCost: 1650 } },
  { label: 'Couple, owns, 2 kids', answers: { ...EMPTY_ANSWERS, monthlyIncome: 9200, housing: 'own' as const, housingCost: 2600, household: 'partnered' as const, dependents: 2 } },
  { label: 'Tight budget with debt', answers: { ...EMPTY_ANSWERS, monthlyIncome: 3200, housing: 'rent' as const, housingCost: 1400, hasDebt: true, debtBalance: 8000, debtPayment: 250 } },
]

for (const c of cases) {
  const b = buildStarterBudget(c.answers)
  console.log(`\n=== ${c.label} ===`)
  console.log('income     ', money(totalIncome(b)))
  console.log('expenses   ', money(totalExpenses(b)), `(${b.expenses.length} lines)`)
  console.log('unallocated', money(unallocated(b)), unallocated(b) >= 0 ? 'OK' : 'NEGATIVE')
  console.log('goals      ', b.goals.map((g) => `${g.name} ${money(g.monthly)}/mo`).join(', ') || 'none')
  for (const g of groupSummaries(b)) console.log('  ', money(g.total).padStart(9), g.group.name)
}
