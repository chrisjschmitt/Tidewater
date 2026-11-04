import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { amountIn } from '../../lib/etm/format'
import { periodLabel, type Period } from '../../lib/etm/period'
import { dailyCompare, type CompareLine } from '../../lib/etm/dailyCompare'
import type { Transaction } from '../../lib/etm/types'

/**
 * Transactions tab: budget spend day by day as Monarch counts it beside as TD
 * counts it, whichever feed the budget is on. Tap a day for its rows side by
 * side; the ones that make the difference come first and are marked.
 */
export default function FeedCompareCard({ data, period }: { data: EtmData; period: Period }) {
  const [open, setOpen] = useState(false)
  const [onlyDiffering, setOnlyDiffering] = useState(true)
  const [day, setDay] = useState<string | null>(null)
  const hasTd = useMemo(() => data.allRows.some((r) => r.source === 'td'), [data.allRows])

  const days = useMemo(
    () =>
      open && hasTd
        ? dailyCompare(data.allRows, {
            period,
            accounts: data.accounts,
            reimbursableTag: data.config.reimbursableTag,
            ...(data.config.categoryGroups ? { groups: data.config.categoryGroups } : {}),
            ...(data.config.monthCutoffs ? { cutoffs: data.config.monthCutoffs } : {}),
          })
        : [],
    [open, hasTd, data.allRows, data.accounts, data.config, period],
  )
  if (!hasTd) return null

  const monarchTotal = days.reduce((s, d) => s + d.monarchSpend, 0)
  const tdTotal = days.reduce((s, d) => s + d.tdSpend, 0)
  const differs = (a: number, z: number) => Math.round(a * 100) !== Math.round(z * 100)
  const shown = onlyDiffering ? days.filter((d) => differs(d.monarchSpend, d.tdSpend)) : days
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.nickname ?? 'Account'

  return (
    <section className="card mb-4 p-6">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span>
          <span className="text-base font-semibold tracking-tight text-ink-900">TD vs Monarch, day by day</span>
          <span className="ml-2 text-sm text-ink-500">{periodLabel(period)}</span>
        </span>
        <span className="text-xs text-tide-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <p className="mt-1 max-w-prose text-xs text-ink-500">
            Budget spend as each feed would count it, whichever one the budget is on now. Rows the two share (entered by
            hand, or on an account with no TD feed) count the same on both sides.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <span>
              Monarch <strong className="tabular-nums">{amountIn(monarchTotal, 'CAD')}</strong>
            </span>
            <span>
              TD <strong className="tabular-nums">{amountIn(tdTotal, 'CAD')}</strong>
            </span>
            <span className={differs(monarchTotal, tdTotal) ? 'text-shell-600' : 'text-ink-500'}>
              Difference <strong className="tabular-nums">{amountIn(tdTotal - monarchTotal, 'CAD')}</strong>
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600">
              <input type="checkbox" checked={onlyDiffering} onChange={(e) => setOnlyDiffering(e.target.checked)} />
              Only days that differ
            </label>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500">
                  <th className="pb-2 pr-3 font-medium">Day</th>
                  <th className="pb-2 pr-3 text-right font-medium">Monarch</th>
                  <th className="pb-2 pr-3 text-right font-medium">TD</th>
                  <th className="pb-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-200/80">
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-ink-500">
                      {onlyDiffering ? 'Every day agrees.' : 'No budget spend in this period.'}
                    </td>
                  </tr>
                )}
                {shown.map((d) => {
                  const gap = differs(d.monarchSpend, d.tdSpend)
                  const expanded = day === d.date
                  return [
                    <tr
                      key={`day|${d.date}`}
                      className={`cursor-pointer hover:bg-sand-100/50 ${gap ? 'bg-shell-50/60' : ''}`}
                      onClick={() => setDay(expanded ? null : d.date)}
                    >
                      <td className="py-1.5 pr-3 text-ink-900">
                        {expanded ? '▾' : '▸'} {d.date}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{amountIn(d.monarchSpend, 'CAD')}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{amountIn(d.tdSpend, 'CAD')}</td>
                      <td className={`py-1.5 text-right tabular-nums ${gap ? 'font-medium text-shell-600' : 'text-ink-400'}`}>
                        {gap ? amountIn(d.tdSpend - d.monarchSpend, 'CAD') : '—'}
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={`lines|${d.date}`}>
                        <td colSpan={4} className="pb-3">
                          <div className="space-y-2">
                            {d.lines.map((l, i) => (
                              <LineView key={`line|${d.date}|${i}`} line={l} accountName={accountName} day={d.date} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

const KIND_WORDS: Record<CompareLine['kind'], string> = {
  paired: 'Same purchase in both',
  monarchOnly: 'Only in Monarch — pending, or not in TD’s file',
  tdOnly: 'Only in TD — not in Monarch (yet)',
  shared: 'Same row on both sides (hand-entered, or no TD feed)',
}

function LineView({
  line,
  accountName,
  day,
}: {
  line: CompareLine
  accountName: (id: string) => string
  day: string
}) {
  const gap = Math.round(line.monarchSpend * 100) !== Math.round(line.tdSpend * 100)
  const why = !gap
    ? KIND_WORDS[line.kind]
    : line.kind === 'paired'
      ? [...line.monarch, ...line.td].some((t) => t.date !== day)
        ? 'Dated differently — counts in another month on one side'
        : 'Filed differently'
      : KIND_WORDS[line.kind]
  return (
    <div className={`rounded-xl px-3 py-2 text-xs ${gap ? 'bg-shell-50 ring-1 ring-shell-200' : 'bg-sand-50'}`}>
      <div className="mb-1 flex flex-wrap justify-between gap-2">
        <span className={gap ? 'font-medium text-shell-700' : 'text-ink-500'}>{why}</span>
        {gap && (
          <span className="tabular-nums text-shell-700">
            Monarch {amountIn(line.monarchSpend, 'CAD')} · TD {amountIn(line.tdSpend, 'CAD')}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Side label="Monarch" rows={line.monarch} accountName={accountName} day={day} />
        <Side label="TD" rows={line.td} accountName={accountName} day={day} />
      </div>
    </div>
  )
}

function Side({
  label,
  rows,
  accountName,
  day,
}: {
  label: string
  rows: Transaction[]
  accountName: (id: string) => string
  day: string
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      {rows.length === 0 ? (
        <p className="text-ink-400">—</p>
      ) : (
        rows.map((t) => (
          <p key={t.id} className="flex justify-between gap-2">
            <span className="min-w-0">
              <span className="text-ink-900">{t.merchant || t.originalStatement}</span>
              <span className="text-ink-500">
                {' '}
                · {t.category}
                {t.tags.length > 0 && ` · ${t.tags.join(', ')}`} · {accountName(t.accountId)}
                {t.date !== day && ` · dated ${t.date}`}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{amountIn(t.amount, t.currency)}</span>
          </p>
        ))
      )}
    </div>
  )
}
