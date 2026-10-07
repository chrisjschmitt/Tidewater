import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { CategorySelect, TagPicker } from './pickers'
import { settleRow } from '../../lib/etm/review'
import { statementKey } from '../../lib/etm/rules/normalize'
import type { UserRule } from '../../lib/etm/rules/types'
import type { SplitLine, Transaction } from '../../lib/etm/types'
import { uid } from '../../lib/format'

/**
 * One form for one transaction: merchant, comment, and its category and tags —
 * split into parts if needed, which must add up to the row. Saved into the
 * day's review session (one Undo under Past imports). For TD rows it can also
 * be remembered as a rule for the merchant, or for the merchant at this amount.
 */
export default function TransactionEditor({
  data,
  row,
  onDone,
}: {
  data: EtmData
  /** The stored row (not a split part from the ledger). */
  row: Transaction
  onDone: () => void
}) {
  const start = row.split ?? [{ amount: row.amount, category: row.category === 'Uncategorized' ? '' : row.category, tags: row.tags }]
  const total = Math.abs(row.amount)
  const [merchant, setMerchant] = useState(row.merchant)
  const [notes, setNotes] = useState(row.notes)
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [lines, setLines] = useState(
    start.map((line) => ({
      value: Math.abs(line.amount).toFixed(2),
      category: line.category,
      tags: line.tags,
      notes: (line as { notes?: string }).notes ?? '',
    })),
  )
  const [remember, setRemember] = useState<'none' | 'merchant' | 'amount'>('none')
  const [busy, setBusy] = useState(false)

  const categories = useMemo(() => {
    const names = new Set<string>(data.rules.model.categories)
    for (const r of data.allRows) if (r.category && r.category !== 'Uncategorized') names.add(r.category)
    return [...names].sort((a, z) => a.localeCompare(z))
  }, [data.allRows, data.rules.model.categories])
  const knownTags = useMemo(() => [...new Set(data.allRows.flatMap((r) => r.tags))].sort(), [data.allRows])

  const round = (n: number) => Math.round(n * 100) / 100
  /** Each part in dollars: as typed, or its percentage of the row with rounding in the last part. */
  const amounts = (() => {
    if (mode === 'amount') return lines.map((line) => Number(line.value) || 0)
    let placed = 0
    return lines.map((line, index) => {
      const part = index === lines.length - 1 ? round(total - placed) : round((total * (Number(line.value) || 0)) / 100)
      placed = round(placed + part)
      return part
    })
  })()
  const used = mode === 'amount' ? round(amounts.reduce((s, a) => s + a, 0)) : round(lines.reduce((s, l) => s + (Number(l.value) || 0), 0))
  const target = mode === 'amount' ? total : 100
  const remainder = round(target - used)
  const valid = remainder === 0 && lines.every((line, i) => line.category.trim() && amounts[i]! > 0)
  const setLine = (index: number, patch: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  const switchMode = (next: 'amount' | 'percent') => {
    if (next === mode) return
    setLines(
      lines.map((line, i) => ({
        ...line,
        value: next === 'percent' ? (total === 0 ? '0' : round((amounts[i]! / total) * 100).toString()) : amounts[i]!.toFixed(2),
      })),
    )
    setMode(next)
  }

  const save = async () => {
    const sign = row.amount < 0 ? -1 : 1
    const parts: SplitLine[] = lines.map((line, i) => ({
      amount: round(sign * amounts[i]!),
      category: line.category.trim(),
      tags: line.tags,
      ...(lines.length > 1 && line.notes.trim() ? { notes: line.notes.trim() } : {}),
    }))
    const next = settleRow(row, { merchant: merchant.trim() || row.merchant, notes: notes.trim(), lines: parts }, data.config.categoryGroups)
    setBusy(true)
    try {
      if (remember !== 'none' && row.source === 'td') {
        const sum = parts.reduce((s, l) => s + l.amount, 0)
        const rule: UserRule = {
          id: uid('rule'),
          key: statementKey(row.originalStatement),
          outcome: {
            merchant: next.merchant,
            category: next.category,
            tags: next.tags,
            ...(parts.length > 1
              ? { split: parts.map((l) => ({ category: l.category, tags: l.tags, share: sum === 0 ? 0 : l.amount / sum })) }
              : {}),
          },
          createdAt: new Date().toISOString(),
          ...(remember === 'amount' ? { amount: row.amount } : {}),
        }
        const settings = data.rules.settings
        const same = (r: UserRule) => r.key === rule.key && !r.accountId && r.amount === rule.amount
        await data.saveSettings({ ...data.config, rules: { ...settings, userRules: [...settings.userRules.filter((r) => !same(r)), rule] } })
      }
      await data.saveRows([next])
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-2xl bg-sand-100/60 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Merchant
          <input className="field flex-1 py-1 text-sm" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Comment
          <input className="field flex-1 py-1 text-sm" placeholder="Optional, for the whole transaction" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {lines.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-ink-500">
          Split by:
          {(['amount', 'percent'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-full px-2.5 py-0.5 ${mode === m ? 'bg-tide-600 text-white' : 'bg-white text-ink-700 ring-1 ring-sand-200'}`}
            >
              {m === 'amount' ? 'Amount' : '%'}
            </button>
          ))}
        </div>
      )}
      {lines.map((line, index) => (
        <div key={index} className="space-y-1 rounded-xl bg-white/60 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1">
              <input
                className="field w-24 py-1 text-right text-sm tabular-nums"
                inputMode="decimal"
                aria-label={mode === 'amount' ? 'Amount' : 'Percent'}
                value={line.value}
                onChange={(e) => setLine(index, { value: e.target.value })}
              />
              <span className="text-xs text-ink-400">{mode === 'percent' ? `% = ${amounts[index]!.toFixed(2)}` : ''}</span>
            </span>
            <CategorySelect value={line.category} options={categories} onChange={(category) => setLine(index, { category })} />
            {lines.length > 1 && (
              <button className="btn-quiet text-xs" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                Remove
              </button>
            )}
          </div>
          <TagPicker value={line.tags} options={knownTags} onChange={(tags) => setLine(index, { tags })} />
          {lines.length > 1 && (
            <input
              className="field w-full py-1 text-xs"
              placeholder="Comment for this part (optional)"
              value={line.notes}
              onChange={(e) => setLine(index, { notes: e.target.value })}
            />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          className="btn-quiet text-xs"
          onClick={() =>
            setLines([...lines, { value: remainder > 0 ? remainder.toString() : '', category: '', tags: [], notes: '' }])
          }
        >
          + Split off a part
        </button>
        <span className={remainder === 0 ? 'text-ink-400' : 'text-shell-500'}>
          {remainder === 0
            ? mode === 'percent'
              ? 'Adds up to 100%'
              : 'Adds up to the row'
            : `${remainder > 0 ? 'Still to place' : 'Over by'} ${mode === 'percent' ? `${Math.abs(remainder)}%` : Math.abs(remainder).toFixed(2)}`}
        </span>
      </div>
      {row.source === 'td' && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
          Remember for next time:
          {(
            [
              ['none', 'No, just this one'],
              ['merchant', 'This merchant'],
              ['amount', 'This merchant at this amount'],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className="flex items-center gap-1">
              <input type="radio" checked={remember === id} onChange={() => setRemember(id)} />
              {label}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={busy || !valid} className="btn-primary text-xs disabled:opacity-50" onClick={() => void save()}>
          Save{row.source === 'td' ? ' and confirm' : ''}
        </button>
        <button className="btn-ghost text-xs" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
