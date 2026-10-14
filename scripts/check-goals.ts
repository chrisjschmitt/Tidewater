/**
 * Check for the goal card sentence: "$X in N months · $Y of it is growth" and
 * "Clear in N months · $Y interest" count up to the target, not the chart horizon.
 * Usage: npm run check:goals
 */
import { interestOverHorizon, monthsToTarget } from '../src/lib/goals.ts'
import type { Goal } from '../src/lib/types.ts'

let failed = 0
function expect(label: string, actual: number, expected: number, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual.toFixed(2)} (expected ${expected.toFixed(2)})`)
}

// Chris's goal (2026-10-14): reached in 7 months; the card said $369.42, which is 12 months of growth.
const savings: Goal = { id: 's', name: 'Savings', kind: 'savings', target: 18000, current: 5667, monthly: 2000, annualRate: 2.2, horizonMonths: 12 }
const months = monthsToTarget(savings)
expect('savings months to target', months, 7, 0)
expect('savings growth over 12-month horizon (old label)', interestOverHorizon(savings, 12), 369.42)
const growth = interestOverHorizon(savings, months)
expect('savings growth to target', growth, 150, 5)

// Debt: 1,000 at 12% (1%/month), 300/month → paid off in month 4. The last payment is only what is left.
const debt: Goal = { id: 'd', name: 'Card', kind: 'debt', target: 0, current: 1000, monthly: 300, annualRate: 12, horizonMonths: 24 }
const payoff = monthsToTarget(debt)
expect('debt months to payoff', payoff, 4, 0)
let bal = 1000
let interest = 0
for (let m = 0; m < 4; m++) { const i = bal * 0.01; interest += i; bal = Math.max(0, bal + i - 300) }
expect('debt interest to payoff', interestOverHorizon(debt, payoff), interest)
expect('debt interest same over a longer horizon', interestOverHorizon(debt, 24), interest)

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll goal checks passed')
