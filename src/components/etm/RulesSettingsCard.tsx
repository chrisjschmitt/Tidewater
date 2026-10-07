import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { normalizeTag } from '../../lib/etm/tags'
import { statementKey } from '../../lib/etm/rules/normalize'
import type { RuleSettings } from '../../lib/etm/rules/types'

/**
 * The rules engine's settings, on the Settings tab. Most of what the rules know
 * is learned afresh from history; these are the few choices only the user can
 * make — which categories have been merged, which tags are retired, which
 * account pays dividends, and the rules taught along the way.
 */
export default function RulesSettingsCard({ data }: { data: EtmData }) {
  const settings = data.rules.settings
  const model = data.rules.model
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeTo, setMergeTo] = useState('')
  const [dividend, setDividend] = useState({ number: '', minAmount: '5000', multiple: '1000', category: 'Dividend' })
  const [review, setReview] = useState('')

  const categories = useMemo(
    () => [...new Set(data.allRows.filter((r) => r.source === 'monarch').map((r) => r.category))].sort(),
    [data.allRows],
  )
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of data.allRows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].sort((a, z) => z[1] - a[1])
  }, [data.allRows])
  const retired = new Set(settings.retiredTags.map(normalizeTag))

  const save = (change: (rules: RuleSettings) => RuleSettings) =>
    data.saveSettings({ ...data.config, rules: change(settings) })

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Rules for TD transactions</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        Learned fresh from your history every time it changes: {model.learned.size.toLocaleString()} merchants,{' '}
        {model.templates.size} recurring splits, and owner categories found from your tags (
        {[...new Set(model.ownerBuckets.values())].join(', ') || 'none yet'}). The settings below are the
        choices only you can make.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-ink-900">Merged categories</h3>
      <p className="text-xs text-ink-400">History filed under the first is learned as the second.</p>
      <ul className="mt-2 space-y-1">
        {Object.entries(settings.categoryMerges).map(([from, to]) => (
          <li key={from} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="text-ink-500">{from}</span> → <span className="text-ink-900">{to}</span>
            </span>
            <button
              className="btn-quiet text-xs"
              onClick={() =>
                void save((rules) => {
                  const next = { ...rules.categoryMerges }
                  delete next[from]
                  return { ...rules, categoryMerges: next }
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="field py-1.5 text-sm" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span className="text-sm text-ink-400">becomes</span>
        <input
          className="field py-1.5 text-sm"
          list="rules-categories"
          placeholder="Category"
          value={mergeTo}
          onChange={(e) => setMergeTo(e.target.value)}
        />
        <datalist id="rules-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          className="btn-ghost text-xs"
          disabled={!mergeFrom || !mergeTo.trim() || mergeFrom === mergeTo.trim()}
          onClick={() => {
            void save((rules) => ({ ...rules, categoryMerges: { ...rules.categoryMerges, [mergeFrom]: mergeTo.trim() } }))
            setMergeFrom('')
            setMergeTo('')
          }}
        >
          Add
        </button>
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink-900">Retired tags</h3>
      <p className="text-xs text-ink-400">Ticked tags are never added to a TD row and are ignored in history.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.map(([tag, count]) => (
          <label key={tag} className="flex items-center gap-1.5 rounded-full bg-sand-100 px-2.5 py-1 text-xs text-ink-700">
            <input
              type="checkbox"
              checked={retired.has(normalizeTag(tag))}
              onChange={(e) =>
                void save((rules) => ({
                  ...rules,
                  retiredTags: e.target.checked
                    ? [...rules.retiredTags, tag]
                    : rules.retiredTags.filter((t) => normalizeTag(t) !== normalizeTag(tag)),
                }))
              }
            />
            {tag} <span className="text-ink-400">{count}</span>
          </label>
        ))}
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink-900">Dividend accounts</h3>
      <p className="text-xs text-ink-400">
        Money in from this account is a dividend when it is at least the amount and a round multiple; other
        amounts are repayments (Transfer), and an odd round amount is checked by you.
      </p>
      <ul className="mt-2 space-y-1">
        {settings.dividendSources.map((source) => (
          <li key={source.number} className="flex items-center justify-between gap-3 text-sm text-ink-700">
            <span>
              …{source.number.slice(-4)}: {source.category} from {source.minAmount.toLocaleString()} in multiples of{' '}
              {source.multiple.toLocaleString()}
            </span>
            <button
              className="btn-quiet text-xs"
              onClick={() =>
                void save((rules) => ({ ...rules, dividendSources: rules.dividendSources.filter((s) => s.number !== source.number) }))
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <input className="field w-32 py-1.5" placeholder="Account number" value={dividend.number} onChange={(e) => setDividend({ ...dividend, number: e.target.value.trim() })} />
        <input className="field w-24 py-1.5" inputMode="decimal" value={dividend.minAmount} onChange={(e) => setDividend({ ...dividend, minAmount: e.target.value })} aria-label="Smallest dividend" />
        <input className="field w-20 py-1.5" inputMode="decimal" value={dividend.multiple} onChange={(e) => setDividend({ ...dividend, multiple: e.target.value })} aria-label="Multiple" />
        <input className="field w-32 py-1.5" list="rules-categories" value={dividend.category} onChange={(e) => setDividend({ ...dividend, category: e.target.value })} aria-label="Category" />
        <button
          className="btn-ghost text-xs"
          disabled={!/^\d{4,}$/.test(dividend.number)}
          onClick={() => {
            void save((rules) => ({
              ...rules,
              dividendSources: [
                ...rules.dividendSources.filter((s) => s.number !== dividend.number),
                {
                  number: dividend.number,
                  minAmount: Number(dividend.minAmount) || 0,
                  multiple: Number(dividend.multiple) || 1,
                  category: dividend.category.trim() || 'Dividend',
                },
              ],
            }))
            setDividend({ ...dividend, number: '' })
          }}
        >
          Add
        </button>
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink-900">Always check</h3>
      <p className="text-xs text-ink-400">Merchants whose rows are always offered for review, e.g. a store where upkeep and upgrades look alike.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {settings.alwaysReview.map((key) => (
          <li key={key} className="flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-xs text-ink-700">
            {key}
            <button
              className="text-ink-400 hover:text-ink-900"
              aria-label={`Stop always checking ${key}`}
              onClick={() => void save((rules) => ({ ...rules, alwaysReview: rules.alwaysReview.filter((k) => k !== key) }))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input className="field py-1.5 text-sm" placeholder="Bank text, e.g. CANADIAN TIRE" value={review} onChange={(e) => setReview(e.target.value)} />
        <button
          className="btn-ghost text-xs"
          disabled={!review.trim()}
          onClick={() => {
            const key = statementKey(review)
            void save((rules) => ({ ...rules, alwaysReview: [...new Set([...rules.alwaysReview, key])] }))
            setReview('')
          }}
        >
          Add
        </button>
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink-900">Taught rules</h3>
      {settings.userRules.length === 0 ? (
        <p className="text-xs text-ink-400">None yet. Teach one from “Rules vs Monarch” on the Import tab.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {settings.userRules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-ink-500">
                  {rule.key}
                  {rule.amount !== undefined && ` at ${rule.amount.toFixed(2)}`}
                </span>{' '}
                →{' '}
                <span className="text-ink-900">
                  {rule.outcome.split ? rule.outcome.split.map((l) => l.category).join(' + ') : rule.outcome.category}
                </span>
                {rule.outcome.tags.length > 0 && <span className="text-ink-400"> · {rule.outcome.tags.join(', ')}</span>}
              </span>
              <button
                className="btn-quiet text-xs"
                onClick={() => void save((rules) => ({ ...rules, userRules: rules.userRules.filter((r) => r.id !== rule.id) }))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
