import { useMemo } from 'react'
import { presentIn, runningTotals } from '../../lib/etm/aggregate'
import { amountIn } from '../../lib/etm/format'
import type { Transaction } from '../../lib/etm/types'

interface Props {
  /** Already filtered and ordered by the caller. */
  rows: Transaction[]
  empty: string
  /** Tags to leave off the row, having been said by the heading above it. */
  omitTags?: string[]
}

/**
 * A drill-in list of transactions with a running subtotal. Descriptions are
 * never truncated: the whole reason to open one of these is to read what the
 * rows actually say, and a clipped statement sends you off to another tab to
 * find out.
 */
export default function TransactionTable({ rows, empty, omitTags = [] }: Props) {
  const totals = useMemo(() => runningTotals(rows), [rows])
  const hidden = useMemo(
    () => new Set(omitTags.map((t) => t.trim().toLowerCase())),
    [omitTags],
  )

  if (rows.length === 0) {
    return <p className="px-4 py-4 text-xs text-ink-400">{empty}</p>
  }

  return (
    <div className="px-4 py-2">
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="text-ink-400">
            <th className="w-24 py-1.5 text-left font-medium">Date</th>
            <th className="py-1.5 text-left font-medium">What</th>
            <th className="w-24 py-1.5 text-right font-medium">Amount</th>
            <th className="w-24 py-1.5 text-right font-medium">Running</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-200">
          {rows.map((row, i) => {
            const tags = row.tags.filter((t) => !hidden.has(t.trim().toLowerCase()))
            return (
              <tr key={row.id} className="align-top">
                <td className="py-2 tabular-nums text-ink-500">{row.date}</td>
                <td className="py-2 pr-3">
                  <span className="block break-words text-ink-900">
                    {row.merchant || row.originalStatement || row.category}
                  </span>
                  {row.originalStatement && row.originalStatement !== row.merchant && (
                    <span className="mt-0.5 block break-words text-ink-400">
                      {row.originalStatement}
                    </span>
                  )}
                  {row.notes && (
                    <span className="mt-0.5 block break-words text-ink-500 italic">
                      {row.notes}
                    </span>
                  )}
                  {tags.length > 0 && (
                    <span className="mt-0.5 block break-words text-ink-400">
                      {tags.join(' · ')}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-ink-900">
                  {amountIn(row.amount, row.currency)}
                </td>
                <td className="py-2 text-right tabular-nums text-ink-400">
                  {amountIn(totals[i]![row.currency], row.currency)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-sand-300">
            <td colSpan={2} className="py-2 text-ink-500">
              Subtotal
            </td>
            <td colSpan={2} className="py-2 text-right font-semibold tabular-nums text-ink-900">
              {presentIn(totals.at(-1)!)
                .map(([currency, value]) => amountIn(value, currency))
                .join(' · ')}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
