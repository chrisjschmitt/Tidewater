import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import { reapplyPlan } from '../../lib/etm/rules/apply'
import { agreementByMonth, matchFeeds, type FeedPair } from '../../lib/etm/rules/compare'
import { statementKey } from '../../lib/etm/rules/normalize'
import type { Outcome, UserRule } from '../../lib/etm/rules/types'
import { uid } from '../../lib/format'

/**
 * The parallel run, on the Import tab: how the rules filed each TD row beside
 * how Monarch filed the same purchase. Disagreements can teach a rule (“file
 * this merchant the way Monarch did”) or be set aside; a button re-runs the
 * rules over every TD row not yet confirmed, as one undoable batch.
 */
export default function RulesCompareCard({ data }: { data: EtmData }) {
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [taught, setTaught] = useState<Set<string>>(new Set())
  const [showLeft, setShowLeft] = useState(false)
  const [showTdOnly, setShowTdOnly] = useState(false)
  const td = useMemo(() => data.allRows.filter((row) => row.source === 'td'), [data.allRows])

  const comparison = useMemo(() => {
    if (td.length === 0) return null
    const dates = td.map((row) => row.date).sort()
    const from = shiftDays(dates[0]!, -3)
    const to = shiftDays(dates[dates.length - 1]!, 3)
    const tdAccounts = new Set(td.map((row) => row.accountId))
    const monarch = data.allRows.filter(
      (row) => row.source === 'monarch' && row.date >= from && row.date <= to && tdAccounts.has(row.accountId),
    )
    return matchFeeds(td, monarch, {
      accounts: data.accounts,
      model: data.rules.model,
      settings: data.rules.settings,
      reimbursableTag: data.config.reimbursableTag,
    })
  }, [data.accounts, data.allRows, data.config.reimbursableTag, data.rules, td])

  const plan = useMemo(
    () => (td.length > 0 ? reapplyPlan(data.allRows, data.accounts, data.rules, data.config.categoryGroups) : null),
    [data.accounts, data.allRows, data.config.categoryGroups, data.rules, td.length],
  )

  if (!comparison) return null

  const dismissed = new Set(data.rules.settings.dismissed)
  const agree = comparison.pairs.filter((pair) => pair.agrees).length
  const left = comparison.pairs.filter((pair) => !pair.agrees && dismissed.has(pair.td.id))
  const open = comparison.pairs.filter((pair) => !pair.agrees && (showLeft || !dismissed.has(pair.td.id)))
  const listed = showAll ? open : open.slice(0, 15)
  const byMonth = [...agreementByMonth(comparison.pairs)]
  const months = [...new Set(byMonth.map(([key]) => key.split('|')[1]!))].sort().slice(-3)
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.nickname ?? 'Account'

  const saveRules = async (change: (rules: typeof data.rules.settings) => typeof data.rules.settings) => {
    await data.saveSettings({ ...data.config, rules: change(data.rules.settings) })
  }

  const teach = async (pair: FeedPair, exactAmount: boolean) => {
    const outcome = monarchOutcome(pair)
    const key = statementKey(pair.td.originalStatement)
    const rule: UserRule = {
      id: uid('rule'),
      key,
      outcome,
      createdAt: new Date().toISOString(),
      ...(exactAmount ? { amount: pair.td.amount } : {}),
    }
    const sameScope = (r: UserRule) =>
      r.key === key && !r.accountId && (exactAmount ? r.amount === pair.td.amount : r.amount === undefined)
    const nextSettings = { ...data.rules.settings, userRules: [...data.rules.settings.userRules.filter((r) => !sameScope(r)), rule] }
    setBusy(true)
    try {
      await data.saveSettings({ ...data.config, rules: nextSettings })
      // Re-file this merchant's unconfirmed TD rows straight away, so the
      // effect is visible here rather than waiting for Re-apply.
      const plan = reapplyPlan(data.allRows, data.accounts, { ...data.rules, settings: nextSettings }, data.config.categoryGroups, key)
      if (plan.updated.length > 0) await data.applyImport(plan)
      setTaught((current) => new Set([...current, pair.td.id]))
      data.flash(
        `Taught: ${outcome.merchant}${exactAmount ? ` at ${amountIn(pair.td.amount, pair.td.currency)}` : ''} is filed as ${outcome.split ? outcome.split.map((l) => l.category).join(' + ') : outcome.category}. ${plan.updated.length} TD row${plan.updated.length === 1 ? '' : 's'} updated.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl bg-white/70 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-900">Rules vs Monarch</p>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            {comparison.pairs.length > 0
              ? `${agree} of ${comparison.pairs.length} TD rows were filed the way Monarch filed them (${Math.round((agree / comparison.pairs.length) * 100)}%).`
              : 'No TD row has a Monarch row to compare with yet.'}{' '}
            {comparison.tdOnly.length > 0 && (
              <button className="underline decoration-dotted underline-offset-4" onClick={() => setShowTdOnly(!showTdOnly)}>
                {comparison.tdOnly.length} TD rows have nothing in Monarch
              </button>
            )}
            {comparison.tdOnly.length > 0 && '. '}
            Until the switch-over, Monarch’s rows still count; this is the practice run.
          </p>
        </div>
        {plan && plan.updated.length > 0 && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await data.applyImport(plan)
              } finally {
                setBusy(false)
              }
            }}
            className="btn-primary text-xs disabled:opacity-50"
            title="Runs the current rules over TD rows you have not confirmed. Undo it from Past imports."
          >
            Re-apply rules to {plan.updated.length} TD row{plan.updated.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {months.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-ink-400">
                <th className="pb-1 pr-3 font-medium">Account</th>
                {months.map((m) => (
                  <th key={m} className="pb-1 pr-3 text-right font-medium">
                    {monthName(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...new Set(byMonth.map(([key]) => key.split('|')[0]!))].map((accountId) => (
                <tr key={accountId}>
                  <td className="py-0.5 pr-3 text-ink-700">{accountName(accountId)}</td>
                  {months.map((m) => {
                    const cell = byMonth.find(([key]) => key === `${accountId}|${m}`)?.[1]
                    return (
                      <td key={m} className="py-0.5 pr-3 text-right tabular-nums text-ink-500">
                        {cell ? `${Math.round((cell.agree / cell.total) * 100)}% of ${cell.total}` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showTdOnly && comparison.tdOnly.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-400">
            In the TD file but not in Monarch — usually days after Monarch's export ends, or a purchase Monarch missed.
          </p>
          <ul className="divide-y divide-sand-200/80 text-sm">
            {comparison.tdOnly
              .slice()
              .sort((a, z) => z.date.localeCompare(a.date))
              .map((row) => (
                <li key={row.id} className="flex justify-between gap-3 py-1">
                  <span className="min-w-0 truncate">
                    <span className="tabular-nums text-ink-500">{row.date}</span> · {accountName(row.accountId)} ·{' '}
                    {row.originalStatement}
                  </span>
                  <span className="tabular-nums text-ink-700">{amountIn(row.amount, row.currency)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {left.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
          Show the {left.length} row{left.length === 1 ? '' : 's'} I left
        </label>
      )}

      {open.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-xs text-ink-400">
            Where they differ. “Teach” files this merchant the way Monarch did from now on; “This amount”
            does so only for this exact amount (two deposits from one payer, say); “Leave” keeps Tidewater’s
            answer and takes the row off this list. Don’t teach merchants whose category depends on what was
            bought or for whom — Amazon, e-transfers — those belong in review.
          </p>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="pb-1 pr-3 font-medium">Date</th>
                <th className="pb-1 pr-3 font-medium">Bank text</th>
                <th className="pb-1 pr-3 text-right font-medium">Amount</th>
                <th className="pb-1 pr-3 font-medium">Tidewater</th>
                <th className="pb-1 pr-3 font-medium">Monarch</th>
                <th className="pb-1 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-200/80">
              {listed.map((pair) => (
                <tr key={pair.td.id}>
                  <td className="py-1.5 pr-3 tabular-nums text-ink-500">{pair.td.date}</td>
                  <td className="max-w-[14rem] truncate py-1.5 pr-3 text-ink-900">{pair.td.originalStatement}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink-700">
                    {amountIn(pair.td.amount, pair.td.currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-700">
                    {pair.tdCategories.join(' + ')}
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-ink-400">
                      {pair.td.prediction?.layer ?? ''}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-ink-700">{pair.monarchCategories.join(' + ')}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {taught.has(pair.td.id) && <span className="mr-2 text-xs text-tide-700">Taught ✓</span>}
                    <button
                      disabled={busy}
                      onClick={() => void teach(pair, false)}
                      className="btn-ghost text-xs disabled:opacity-50"
                      title="Always file this merchant the way Monarch filed this row"
                    >
                      Teach
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void teach(pair, true)}
                      className="btn-quiet text-xs disabled:opacity-50"
                      title="Only when this merchant charges exactly this amount (e.g. two pension deposits, one per person)"
                    >
                      This amount
                    </button>
                    {dismissed.has(pair.td.id) ? (
                      <button
                        onClick={() => void saveRules((rules) => ({ ...rules, dismissed: rules.dismissed.filter((id) => id !== pair.td.id) }))}
                        className="btn-quiet text-xs"
                        title="Put it back on the list"
                      >
                        Un-leave
                      </button>
                    ) : (
                      <button
                        onClick={() => void saveRules((rules) => ({ ...rules, dismissed: [...rules.dismissed, pair.td.id] }))}
                        className="btn-quiet text-xs"
                      >
                        Leave
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {open.length > listed.length && (
            <button onClick={() => setShowAll(true)} className="btn-quiet mt-2 text-xs">
              Show all {open.length}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Monarch's answer for a purchase as a rule: its category and tags, or its split as fixed amounts. */
function monarchOutcome(pair: FeedPair): Outcome {
  const [first] = pair.monarch
  const merchant = first?.merchant || pair.td.merchant
  if (pair.monarch.length > 1) {
    // As shares, so the split still fits when next month's amount differs.
    const total = pair.monarch.reduce((sum, row) => sum + row.amount, 0)
    const lines = pair.monarch
      .map((row) => ({ category: row.category, tags: row.tags, share: total === 0 ? 0 : row.amount / total }))
      .sort((a, z) => z.share - a.share)
    return { merchant, category: lines[0]!.category, tags: lines[0]!.tags, split: lines }
  }
  return { merchant, category: first?.category ?? 'Uncategorized', tags: first?.tags ?? [] }
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10)
}
