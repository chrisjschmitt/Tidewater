import { useMemo } from 'react'
import TransactionTable from './TransactionTable'
import {
  filterTransactions,
  isReimbursable,
  noFilters,
} from '../../lib/etm/aggregate'
import { DEFAULT_CONFIG } from '../../lib/etm/config'
import type { Period } from '../../lib/etm/period'
import type { Transaction } from '../../lib/etm/types'

interface Props {
  category: string
  period: Period
  transactions: Transaction[]
  /** Accounts kept out of the family budget, so the rows match the totals. */
  excluded?: Set<string>
  reimbursableTag?: string
}

/**
 * The transactions behind one category, oldest first. Reimbursables are left
 * out here as they are everywhere in budget-vs-actual (§5) — a drill-in whose
 * rows did not add up to the figure that was clicked would be worse than none.
 */
export default function CategoryTransactions({
  category,
  period,
  transactions,
  excluded,
  reimbursableTag = DEFAULT_CONFIG.reimbursableTag,
}: Props) {
  const rows = useMemo(() => {
    const visible = transactions.filter(
      (t) => !excluded?.has(t.accountId) && !isReimbursable(t, reimbursableTag),
    )
    return filterTransactions(visible, period, { ...noFilters(), categories: [category] })
      .slice()
      .sort((a, z) => a.date.localeCompare(z.date))
  }, [transactions, period, category, excluded, reimbursableTag])

  return <TransactionTable rows={rows} empty="Nothing was spent here in this period." />
}
