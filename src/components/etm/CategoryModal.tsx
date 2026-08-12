import CategoryTransactions from './CategoryTransactions'
import Modal from '../Modal'
import { periodLabel, type Period } from '../../lib/etm/period'
import type { Transaction } from '../../lib/etm/types'

interface Props {
  category: string
  period: Period
  transactions: Transaction[]
  excluded: Set<string>
  reimbursableTag: string
  onClose: () => void
}

/**
 * The same drill-down the Budget tab shows, reached from the dashboard's own
 * group modal. It layers over that modal rather than replacing it, so closing
 * this returns to the plan the user was adjusting.
 */
export default function CategoryModal({
  category,
  period,
  transactions,
  excluded,
  reimbursableTag,
  onClose,
}: Props) {
  return (
    // Every modal shares one z-index, and this one is mounted earlier in the
    // tree than the dashboard's group modal it opens from. The wrapper lifts
    // its whole subtree above that sibling.
    <div className="relative z-[60]">
      <Modal
        open
        onClose={onClose}
        width="max-w-3xl"
        title={category}
        subtitle={`What made this up in ${periodLabel(period)}`}
      >
        <div className="rounded-2xl bg-white/70">
          <CategoryTransactions
            category={category}
            period={period}
            transactions={transactions}
            excluded={excluded}
            reimbursableTag={reimbursableTag}
          />
        </div>
      </Modal>
    </div>
  )
}
