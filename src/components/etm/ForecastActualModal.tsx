import { useMemo } from 'react'
import TransactionTable from './TransactionTable'
import Modal from '../Modal'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { Transaction } from '../../lib/etm/types'
import { householdRowsIn } from '../../lib/forecast/universe'
import type { ForecastConfig } from '../../lib/forecast/types'

interface Props {
  category: { key: string; label: string }
  month: string
  transactions: Transaction[]
  /** Resolved with defaults, as the engine uses it. */
  config: ForecastConfig
  reimbursableParentTag: string
  onEdit?: (row: Transaction) => void
  onClose: () => void
}

/**
 * The rows behind a category's "Actual to today", newest first. They are the
 * engine's own household rows for the month, so the running figure on the top
 * row is the amount that was clicked.
 */
export default function ForecastActualModal({
  category,
  month,
  transactions,
  config,
  reimbursableParentTag,
  onEdit,
  onClose,
}: Props) {
  const { rows, spendSoFar } = useMemo(() => {
    const chronological = householdRowsIn(transactions, config, category.key, month, reimbursableParentTag).sort(
      (a, z) => a.date.localeCompare(z.date) || a.id.localeCompare(z.id),
    )
    const running = new Map<string, number>()
    let sum = 0
    for (const row of chronological) {
      sum = Math.round((sum - row.amount) * 100) / 100
      running.set(row.id, sum)
    }
    return { rows: chronological.reverse(), spendSoFar: { running, total: sum } }
  }, [transactions, config, category.key, month, reimbursableParentTag])

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={category.label}
      subtitle={`${amountIn(spendSoFar.total, 'CAD')} so far in ${monthName(month)} · newest first`}
    >
      <div className="rounded-2xl bg-white/70">
        <TransactionTable
          rows={rows}
          empty="Nothing was spent here this month."
          spendSoFar={spendSoFar}
          {...(onEdit ? { onEdit } : {})}
        />
      </div>
    </Modal>
  )
}
