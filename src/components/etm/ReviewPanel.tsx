import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import TransactionEditor from './TransactionEditor'
import { settleRow } from '../../lib/etm/review'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { UserRule } from '../../lib/etm/rules/types'
import type { SplitLine, Transaction } from '../../lib/etm/types'

/**
 * The TD rows the rules could not settle, and the ones they did, for the user
 * to confirm. Each change is made in one step — category, tags and any split
 * together — and saved into the day's review session, which is one Undo under
 * Past imports. A confirmed row is the user's word: rules never touch it again,
 * and it teaches the rules like any Monarch row.
 */

type Show = 'needs' | 'unconfirmed' | 'confirmed' | 'all'


const needsLook = (row: Transaction) =>
  !row.reviewed &&
  (row.category === 'Uncategorized' || row.prediction?.layer === 'review' || (row.prediction?.reviewReasons.length ?? 0) > 0)

export default function ReviewPanel({ data }: { data: EtmData }) {
  const td = useMemo(() => data.allRows.filter((row) => row.source === 'td' && !row.duplicateOf), [data.allRows])
  const months = useMemo(() => [...new Set(td.map((row) => row.date.slice(0, 7)))].sort().reverse(), [td])
  const [month, setMonth] = useState<string>('')
  const [show, setShow] = useState<Show>('needs')
  const [editing, setEditing] = useState<string | null>(null)
  const [limit, setLimit] = useState(40)
  const [busy, setBusy] = useState(false)
  const activeMonth = month || months[0] || ''

  const inMonth = td.filter((row) => row.date.startsWith(activeMonth))
  const counts = {
    needs: inMonth.filter(needsLook).length,
    settled: inMonth.filter((row) => !row.reviewed && !needsLook(row)).length,
    confirmed: inMonth.filter((row) => row.reviewed).length,
  }
  const listed = inMonth
    .filter((row) =>
      show === 'needs' ? needsLook(row) : show === 'unconfirmed' ? !row.reviewed : show === 'confirmed' ? row.reviewed : true,
    )
    .sort((a, z) => z.date.localeCompare(a.date) || a.originalStatement.localeCompare(z.originalStatement))

  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.nickname ?? ''

  const settle = (row: Transaction, merchant: string, lines: SplitLine[]) =>
    settleRow(row, { merchant, lines }, data.config.categoryGroups)

  const save = async (rows: Transaction[], rule?: UserRule) => {
    setBusy(true)
    try {
      if (rule) {
        const settings = data.rules.settings
        const sameScope = (r: UserRule) => r.key === rule.key && !r.accountId && r.amount === rule.amount
        await data.saveSettings({
          ...data.config,
          rules: { ...settings, userRules: [...settings.userRules.filter((r) => !sameScope(r)), rule] },
        })
      }
      await data.saveRows(rows)
    } finally {
      setBusy(false)
    }
  }

  if (td.length === 0) {
    return (
      <section className="card p-6 text-sm text-ink-500">
        No TD transactions yet. Read a TD-transactions file on the Import tab and they appear here for review.
      </section>
    )
  }

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Review TD transactions</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            {counts.needs} need a look · {counts.settled} settled by the rules, not yet confirmed · {counts.confirmed}{' '}
            confirmed. Confirming a row tells the rules they were right; changing one in a single step sets its
            category, tags and any split together. Today’s changes are one Undo under Import → Past imports.
          </p>
        </div>
        <select className="field py-1.5 text-sm" value={activeMonth} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(
          [
            ['needs', `Need a look (${counts.needs})`],
            ['unconfirmed', `Not confirmed (${counts.needs + counts.settled})`],
            ['confirmed', `Confirmed (${counts.confirmed})`],
            ['all', 'All'],
          ] as Array<[Show, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setShow(id)}
            className={`rounded-full px-3 py-1 text-xs ${show === id ? 'bg-tide-600 text-white' : 'bg-sand-100 text-ink-700'}`}
          >
            {label}
          </button>
        ))}
        {counts.settled > 0 && (
          <button
            disabled={busy}
            className="btn-ghost ml-auto text-xs disabled:opacity-50"
            onClick={() =>
              void save(
                inMonth
                  .filter((row) => !row.reviewed && !needsLook(row))
                  .map((row) => ({ ...row, reviewed: true })),
              )
            }
            title="Marks every row the rules settled this month as right. Rows that need a look are left alone."
          >
            Confirm the {counts.settled} settled rows
          </button>
        )}
      </div>

      <ul className="mt-4 divide-y divide-sand-200/80">
        {listed.slice(0, limit).map((row) => {
          const lines = row.split ?? [{ amount: row.amount, category: row.category, tags: row.tags }]
          const suggestions = (row.prediction?.suggestions ?? []).slice(0, 3)
          return (
            <li key={row.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink-900">{row.merchant}</span>
                  <span className="ml-2 text-xs text-ink-400">
                    {row.date} · {accountName(row.accountId)} · {row.originalStatement}
                  </span>
                </span>
                <span className="text-sm tabular-nums text-ink-900">{amountIn(row.amount, row.currency)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className={row.category === 'Uncategorized' ? 'text-shell-500' : 'text-ink-700'}>
                  {lines
                    .map((l) => `${l.category}${lines.length > 1 ? ` ${amountIn(l.amount, row.currency)}` : ''}${l.notes ? ` (${l.notes})` : ''}`)
                    .join(' + ')}
                </span>
                {lines.length > 1 && (
                  <span className="rounded-full bg-sand-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
                    Split in {lines.length}
                  </span>
                )}
                {row.tags.length > 0 && <span className="text-xs text-ink-400">{row.tags.join(', ')}</span>}
                {row.notes && <span className="text-xs italic text-ink-500">{row.notes}</span>}
                {row.reviewed && <span className="rounded-full bg-tide-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-tide-700">Confirmed</span>}
                {!row.reviewed && row.prediction?.layer && (
                  <span className="text-[10px] uppercase tracking-wider text-ink-400">{row.prediction.layer}</span>
                )}
              </div>
              {!row.reviewed && (row.prediction?.reviewReasons.length ?? 0) > 0 && (
                <p className="mt-0.5 text-xs text-ink-400">{row.prediction!.reviewReasons.join(' · ')}</p>
              )}

              {editing !== row.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {suggestions.map((s, index) => (
                    <button
                      key={index}
                      disabled={busy}
                      className="rounded-full bg-sand-100 px-3 py-1 text-xs text-ink-700 hover:bg-tide-50 disabled:opacity-50"
                      onClick={() =>
                        void save([
                          settle(
                            row,
                            s.merchant,
                            s.split && s.split.length > 1 ? s.split : [{ amount: row.amount, category: s.category, tags: s.tags }],
                          ),
                        ])
                      }
                      title="File it this way and confirm"
                    >
                      {s.split && s.split.length > 1 ? s.split.map((l) => l.category).join(' + ') : s.category}
                      {s.tags.length > 0 && <span className="text-ink-400"> · {s.tags.join(', ')}</span>}
                    </button>
                  ))}
                  {!row.reviewed && row.category !== 'Uncategorized' && (
                    <button
                      disabled={busy}
                      className="btn-ghost text-xs disabled:opacity-50"
                      onClick={() => void save([{ ...row, reviewed: true }])}
                    >
                      Confirm
                    </button>
                  )}
                  <button className="btn-quiet text-xs" onClick={() => setEditing(row.id)}>
                    Change…
                  </button>
                </div>
              )}

              {editing === row.id && (
                <div className="mt-3">
                  <TransactionEditor data={data} row={row} onDone={() => setEditing(null)} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {listed.length === 0 && <p className="mt-4 text-sm text-ink-500">Nothing here for {monthName(activeMonth)}.</p>}
      {listed.length > limit && (
        <button className="btn-quiet mt-2 text-xs" onClick={() => setLimit(limit + 40)}>
          Show more ({listed.length - limit} left)
        </button>
      )}
    </section>
  )
}
