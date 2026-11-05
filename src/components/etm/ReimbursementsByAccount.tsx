import { useState } from 'react'
import TransactionTable from './TransactionTable'
import { amountIn } from '../../lib/etm/format'
import { monthName, monthPeriod } from '../../lib/etm/period'
import { checkKey, type MonthReimbursements } from '../../lib/etm/monthEnd'
import { reimbursableCsv, reimbursableFileName } from '../../lib/etm/reimbursableExport'
import { bucketName, type EtmConfig } from '../../lib/etm/config'
import type { Account, Transaction } from '../../lib/etm/types'

/**
 * Month end → Reimbursements, laid out like the reimbursements sheet: each
 * paying account, then each bucket on it with its rows and sum. Tick a bucket
 * once it has been checked; fix a row with Edit and the sums follow at once.
 */
export default function ReimbursementsByAccount({
  month,
  groups,
  checked,
  onCheck,
  transactions,
  accounts,
  config,
  onEdit,
}: {
  month: string
  groups: MonthReimbursements
  checked: string[]
  onCheck: (key: string, on: boolean) => void
  /** For the CSV: the ledger rows. */
  transactions: Transaction[]
  accounts: Account[]
  config: EtmConfig
  onEdit?: (row: Transaction) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const ticked = new Set(checked)

  if (groups.count === 0) {
    return <p className="text-sm text-ink-500">Nothing in {monthName(month)} is tagged as reimbursable.</p>
  }

  const exportCsv = () => {
    const period = monthPeriod(month)
    const { csv } = reimbursableCsv(transactions, accounts, period, config.reimbursableTag, config.reimbursedOn, (bucket) =>
      bucketName(config, bucket),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = reimbursableFileName(period)
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          Owed back to the family accounts <strong className="tabular-nums">{amountIn(groups.owed, 'CAD')}</strong>
        </span>
        {groups.own !== 0 && (
          <span className="text-ink-500">
            On your own accounts <span className="tabular-nums">{amountIn(groups.own, 'CAD')}</span> (settled there)
          </span>
        )}
        <button type="button" className="btn-ghost ml-auto text-xs" onClick={exportCsv}>
          Export to CSV
        </button>
      </div>

      {groups.accounts.map((group) => (
        <div key={group.account.id} className="rounded-2xl bg-white/70">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sand-200/70 px-4 py-2.5">
            <span className="text-sm font-semibold text-ink-900">
              {group.account.nickname}
              {group.own && <span className="ml-2 text-[11px] font-normal text-ink-400">own account — not owed back</span>}
            </span>
            <span className="text-sm font-semibold tabular-nums text-ink-900">{amountIn(group.total, group.currency)}</span>
          </div>
          <ul className="divide-y divide-sand-200/70">
            {group.buckets.map((bucket) => {
              const key = checkKey(group.account.id, bucket.bucket)
              const isOpen = open === key
              return (
                <li key={key}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={ticked.has(key)}
                      onChange={(e) => onCheck(key, e.target.checked)}
                      aria-label={`${bucket.name} checked`}
                      title="Checked: everything here is theirs to reimburse"
                    />
                    <button type="button" onClick={() => setOpen(isOpen ? null : key)} className="min-w-0 flex-1 text-left">
                      <span className="block text-sm text-ink-900">
                        {bucket.name}
                        {bucket.owedBy && <span className="text-ink-400"> · owed by {bucket.owedBy}</span>}
                      </span>
                      <span className="block text-[11px] text-ink-400">
                        {bucket.rows.length} {bucket.rows.length === 1 ? 'transaction' : 'transactions'} {isOpen ? '▾' : '▸'}
                      </span>
                    </button>
                    <span className="text-sm tabular-nums text-ink-900">{amountIn(bucket.total, group.currency)}</span>
                  </div>
                  {isOpen && (
                    <div className="border-t border-sand-200/70">
                      <TransactionTable rows={bucket.rows} empty="" omitTags={[config.reimbursableTag]} {...(onEdit ? { onEdit } : {})} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <p className="text-[11px] text-ink-400">
        Tick each bucket once you have checked that everything in it is that person’s or account’s to reimburse. The
        CSV is every reimbursable row of {monthName(month)}, one line per row or split part.
      </p>
    </div>
  )
}
