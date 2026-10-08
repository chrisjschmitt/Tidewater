import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { findPossibleDuplicates, type DuplicatePair } from '../../lib/etm/duplicates'
import { amountIn } from '../../lib/etm/format'
import type { Transaction } from '../../lib/etm/types'

/**
 * Possible duplicates among the TD rows, at the top of the Review tab. Keeping
 * one marks the other as a duplicate — it stops counting and drops out of
 * review, but stays stored, so a later read of the same file cannot bring it
 * back and the day's Review session can undo it.
 */
export default function DuplicatesCard({ data }: { data: EtmData }) {
  const [busy, setBusy] = useState(false)
  const pairs = useMemo(
    () => findPossibleDuplicates(data.allRows, data.rules.settings.notDuplicates),
    [data.allRows, data.rules.settings.notDuplicates],
  )
  if (pairs.length === 0) return null
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.nickname ?? ''

  const keep = async (pair: DuplicatePair, kept: Transaction) => {
    const drop = kept.id === pair.a.id ? pair.z : pair.a
    setBusy(true)
    try {
      // The kept row inherits whatever was confirmed on the other, if it had nothing of its own.
      const next: Transaction[] = [{ ...drop, duplicateOf: kept.id }]
      if (!kept.reviewed && drop.reviewed) {
        next.push({ ...kept, category: drop.category, groupId: drop.groupId, internal: drop.internal, tags: drop.tags, notes: kept.notes || drop.notes, merchant: drop.merchant, reviewed: true, ...(drop.split ? { split: drop.split } : {}) })
      }
      await data.saveRows(next)
    } finally {
      setBusy(false)
    }
  }

  const notDuplicate = async (pair: DuplicatePair) => {
    const rules = data.rules.settings
    await data.saveSettings({ ...data.config, rules: { ...rules, notDuplicates: [...rules.notDuplicates, pair.key] } })
  }

  const side = (pair: DuplicatePair, row: Transaction) => (
    <div className="flex-1 rounded-xl bg-white/70 px-3 py-2">
      <p className="text-sm text-ink-900">
        {row.date} · <span className="tabular-nums">{amountIn(row.amount, row.currency)}</span>
      </p>
      <p className="text-xs text-ink-400">
        {row.category}
        {row.reviewed ? ' · confirmed' : ''} · from {row.feedFile ?? 'an earlier download'}
      </p>
      <button disabled={busy} className="btn-ghost mt-1 text-xs disabled:opacity-50" onClick={() => void keep(pair, row)}>
        Keep this one
      </button>
    </div>
  )

  return (
    <section className="card mb-6 p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Possible duplicates ({pairs.length})</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        The same bank text on the same account, a few days apart, from two different downloads — often a card charge
        whose date or amount changed when it posted (a tip, a hotel deposit). Keep the one that is right; the other stops
        counting. If they really are two purchases, say so and they won't be flagged again.
      </p>
      <ul className="mt-4 space-y-3">
        {pairs.map((pair) => (
          <li key={pair.key} className="rounded-2xl bg-sand-100/60 p-3">
            <p className="mb-2 text-sm font-medium text-ink-900">
              {pair.a.merchant} <span className="text-xs font-normal text-ink-400">· {accountName(pair.a.accountId)} · {pair.a.originalStatement}</span>
              {!pair.sameAmount && (
                <span className="ml-2 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
                  Amount changed
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {side(pair, pair.a)}
              {side(pair, pair.z)}
            </div>
            <button disabled={busy} className="btn-quiet mt-2 text-xs disabled:opacity-50" onClick={() => void notDuplicate(pair)}>
              Not a duplicate — two purchases
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
