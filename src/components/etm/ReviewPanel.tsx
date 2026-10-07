import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { isInternalCategory } from '../../lib/categories'
import { amountIn } from '../../lib/etm/format'
import { etmGroupFor } from '../../lib/etm/groups'
import { monthName } from '../../lib/etm/period'
import { statementKey } from '../../lib/etm/rules/normalize'
import type { UserRule } from '../../lib/etm/rules/types'
import type { SplitLine, Transaction } from '../../lib/etm/types'
import { uid } from '../../lib/format'

/**
 * The TD rows the rules could not settle, and the ones they did, for the user
 * to confirm. Each change is made in one step — category, tags and any split
 * together — and saved into the day's review session, which is one Undo under
 * Past imports. A confirmed row is the user's word: rules never touch it again,
 * and it teaches the rules like any Monarch row.
 */

type Show = 'needs' | 'unconfirmed' | 'confirmed' | 'all'

interface Draft {
  merchant: string
  lines: Array<{ amount: string; category: string; tags: string }>
  remember: 'none' | 'merchant' | 'amount'
}

const needsLook = (row: Transaction) =>
  !row.reviewed &&
  (row.category === 'Uncategorized' || row.prediction?.layer === 'review' || (row.prediction?.reviewReasons.length ?? 0) > 0)

export default function ReviewPanel({ data }: { data: EtmData }) {
  const td = useMemo(() => data.allRows.filter((row) => row.source === 'td'), [data.allRows])
  const months = useMemo(() => [...new Set(td.map((row) => row.date.slice(0, 7)))].sort().reverse(), [td])
  const [month, setMonth] = useState<string>('')
  const [show, setShow] = useState<Show>('needs')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
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

  const categories = useMemo(() => {
    const names = new Set<string>(data.rules.model.categories)
    for (const row of data.allRows) if (row.category && row.category !== 'Uncategorized') names.add(row.category)
    return [...names].sort((a, z) => a.localeCompare(z))
  }, [data.allRows, data.rules.model.categories])
  const knownTags = useMemo(() => [...new Set(data.allRows.flatMap((row) => row.tags))].sort(), [data.allRows])
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.nickname ?? ''

  /** The row as the user settled it: confirmed, with its category, tags and split recomputed together. */
  const settle = (row: Transaction, merchant: string, lines: SplitLine[]): Transaction => {
    const main = [...lines].sort((a, z) => Math.abs(z.amount) - Math.abs(a.amount))[0]!
    const next: Transaction = {
      ...row,
      merchant,
      category: main.category,
      groupId: etmGroupFor(main.category, data.config.categoryGroups),
      internal: isInternalCategory(main.category),
      tags: main.tags,
      reviewed: true,
      prediction: {
        layer: 'manual',
        confidence: 'high',
        reviewReasons: [],
        ...(row.prediction?.suggestions ? { suggestions: row.prediction.suggestions } : {}),
      },
    }
    if (lines.length > 1) next.split = lines
    else delete next.split
    return next
  }

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

  const openEditor = (row: Transaction) => {
    setEditing(row.id)
    const lines = row.split ?? [{ amount: row.amount, category: row.category === 'Uncategorized' ? '' : row.category, tags: row.tags }]
    setDraft({
      merchant: row.merchant,
      lines: lines.map((line) => ({ amount: Math.abs(line.amount).toFixed(2), category: line.category, tags: line.tags.join(', ') })),
      remember: 'none',
    })
  }

  const saveDraft = async (row: Transaction) => {
    if (!draft) return
    const sign = row.amount < 0 ? -1 : 1
    const lines: SplitLine[] = draft.lines.map((line) => ({
      amount: Math.round(sign * Number(line.amount || 0) * 100) / 100,
      category: line.category.trim(),
      tags: line.tags.split(',').map((t) => t.trim()).filter(Boolean),
    }))
    const next = settle(row, draft.merchant.trim() || row.merchant, lines)
    let rule: UserRule | undefined
    if (draft.remember !== 'none') {
      const total = lines.reduce((s, l) => s + l.amount, 0)
      rule = {
        id: uid('rule'),
        key: statementKey(row.originalStatement),
        outcome: {
          merchant: next.merchant,
          category: next.category,
          tags: next.tags,
          ...(lines.length > 1
            ? { split: lines.map((l) => ({ category: l.category, tags: l.tags, share: total === 0 ? 0 : l.amount / total })) }
            : {}),
        },
        createdAt: new Date().toISOString(),
        ...(draft.remember === 'amount' ? { amount: row.amount } : {}),
      }
    }
    await save([next], rule)
    setEditing(null)
    setDraft(null)
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
                  {lines.map((l) => `${l.category}${lines.length > 1 ? ` ${amountIn(l.amount, row.currency)}` : ''}`).join(' + ')}
                </span>
                {row.tags.length > 0 && <span className="text-xs text-ink-400">{row.tags.join(', ')}</span>}
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
                  <button className="btn-quiet text-xs" onClick={() => openEditor(row)}>
                    Change…
                  </button>
                </div>
              )}

              {editing === row.id && draft && (
                <Editor
                  row={row}
                  draft={draft}
                  categories={categories}
                  tags={knownTags}
                  busy={busy}
                  onChange={setDraft}
                  onCancel={() => {
                    setEditing(null)
                    setDraft(null)
                  }}
                  onSave={() => void saveDraft(row)}
                />
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
      <datalist id="review-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </section>
  )
}

function Editor({
  row,
  draft,
  categories,
  tags,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  row: Transaction
  draft: Draft
  categories: string[]
  tags: string[]
  busy: boolean
  onChange: (draft: Draft) => void
  onCancel: () => void
  onSave: () => void
}) {
  void categories
  const total = Math.abs(row.amount)
  const used = draft.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const remainder = Math.round((total - used) * 100) / 100
  const valid = remainder === 0 && draft.lines.every((line) => line.category.trim() && Number(line.amount) > 0)
  const setLine = (index: number, patch: Partial<Draft['lines'][number]>) =>
    onChange({ ...draft, lines: draft.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) })

  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-sand-100/60 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-500">
        Merchant
        <input className="field flex-1 py-1 text-sm" value={draft.merchant} onChange={(e) => onChange({ ...draft, merchant: e.target.value })} />
      </label>
      {draft.lines.map((line, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            className="field w-24 py-1 text-right text-sm tabular-nums"
            inputMode="decimal"
            aria-label="Amount"
            value={line.amount}
            onChange={(e) => setLine(index, { amount: e.target.value })}
          />
          <input
            className="field w-56 py-1 text-sm"
            list="review-categories"
            placeholder="Category"
            value={line.category}
            onChange={(e) => setLine(index, { category: e.target.value })}
          />
          <input
            className="field w-64 py-1 text-sm"
            list={`review-tags-${row.id}`}
            placeholder="Tags, comma separated"
            value={line.tags}
            onChange={(e) => setLine(index, { tags: e.target.value })}
          />
          {draft.lines.length > 1 && (
            <button className="btn-quiet text-xs" onClick={() => onChange({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}>
              Remove
            </button>
          )}
        </div>
      ))}
      <datalist id={`review-tags-${row.id}`}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          className="btn-quiet text-xs"
          onClick={() =>
            onChange({
              ...draft,
              lines: [...draft.lines, { amount: remainder > 0 ? remainder.toFixed(2) : '', category: '', tags: '' }],
            })
          }
        >
          + Split off a part
        </button>
        <span className={remainder === 0 ? 'text-ink-400' : 'text-shell-500'}>
          {remainder === 0 ? 'Adds up to the row' : `${remainder > 0 ? 'Still to place' : 'Over by'} ${Math.abs(remainder).toFixed(2)}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
        Remember for next time:
        {(
          [
            ['none', 'No, just this one'],
            ['merchant', 'This merchant'],
            ['amount', 'This merchant at this amount'],
          ] as Array<[Draft['remember'], string]>
        ).map(([id, label]) => (
          <label key={id} className="flex items-center gap-1">
            <input type="radio" checked={draft.remember === id} onChange={() => onChange({ ...draft, remember: id })} />
            {label}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button disabled={busy || !valid} className="btn-primary text-xs disabled:opacity-50" onClick={onSave}>
          Save and confirm
        </button>
        <button className="btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
