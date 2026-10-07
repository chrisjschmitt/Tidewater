import { useState } from 'react'
import type { EtmData } from './useEtmData'
import { useFeedComparison } from './useFeedComparison'
import type { TdCutover } from '../../lib/etm/config'
import { cutoverFor } from '../../lib/etm/ledger'

/**
 * The switch from Monarch to TD. One date for every account with a TD feed, or
 * a date per account; from it, TD's rows count and Monarch's are kept for
 * comparison. Accounts with no TD feed (a card from another bank) stay on
 * Monarch or manual entry. Nothing is moved or deleted, so a date can be
 * changed or cleared at any time.
 */
export default function SwitchOverCard({ data }: { data: EtmData }) {
  const comparison = useFeedComparison(data)
  const cutover = data.config.tdCutover
  const [globalDraft, setGlobalDraft] = useState(cutover?.global ?? '')

  const tdAccounts = new Set(data.allRows.filter((r) => r.source === 'td').map((r) => r.accountId))
  const withFeed = data.accounts.filter((a) => tdAccounts.has(a.id))
  const without = data.accounts.filter((a) => !tdAccounts.has(a.id))

  const save = (next: TdCutover | undefined) => data.saveSettings({ ...data.config, tdCutover: next })
  const setAccount = (accountId: string, date: string) => {
    const perAccount = { ...(cutover?.perAccount ?? {}) }
    if (date) perAccount[accountId] = date
    else delete perAccount[accountId]
    const next = { ...(cutover?.global ? { global: cutover.global } : {}), perAccount }
    void save(next.global || Object.keys(perAccount).length > 0 ? next : undefined)
  }

  const readiness = (accountId: string) => {
    const pairs = comparison?.pairs.filter((p) => p.td.accountId === accountId) ?? []
    const agree = pairs.filter((p) => p.agrees).length
    const rows = data.allRows.filter((r) => r.source === 'td' && r.accountId === accountId)
    const needs = rows.filter(
      (r) => !r.reviewed && (r.category === 'Uncategorized' || (r.prediction?.reviewReasons.length ?? 0) > 0),
    ).length
    return { pairs: pairs.length, agree, rows: rows.length, needs }
  }

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Switch-over from Monarch</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        From the switch-over date, an account's totals come from its TD rows and Monarch's rows are kept only for
        comparison. A purchase the two feeds date on opposite sides of the switch-over counts once, by TD's date.
        Accounts with no TD feed stay on Monarch (or manual entry). Nothing is moved or deleted — change or clear a
        date at any time.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-700">Every TD account from</span>
        <input className="field py-1.5" type="date" value={globalDraft} onChange={(e) => setGlobalDraft(e.target.value)} />
        <button
          className="btn-primary text-xs disabled:opacity-50"
          disabled={!globalDraft || globalDraft === cutover?.global}
          onClick={() => void save({ global: globalDraft, perAccount: cutover?.perAccount ?? {} })}
        >
          Switch over
        </button>
        {cutover?.global && (
          <button
            className="btn-quiet text-xs"
            onClick={() => {
              setGlobalDraft('')
              const perAccount = cutover.perAccount
              void save(Object.keys(perAccount).length > 0 ? { perAccount } : undefined)
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
              <th className="pb-2 pr-3 font-medium">TD account</th>
              <th className="pb-2 pr-3 text-right font-medium">Agrees with Monarch</th>
              <th className="pb-2 pr-3 text-right font-medium">Still need a look</th>
              <th className="pb-2 pr-3 font-medium">Counts from TD</th>
              <th className="pb-2 font-medium">Own date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-200/80">
            {withFeed.map((account) => {
              const r = readiness(account.id)
              const from = cutoverFor(cutover, account.id)
              const ready = r.pairs > 0 && r.agree / r.pairs >= 0.85 && r.needs === 0
              return (
                <tr key={account.id}>
                  <td className="py-1.5 pr-3 text-ink-900">{account.nickname}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink-700">
                    {r.pairs > 0 ? `${Math.round((r.agree / r.pairs) * 100)}% of ${r.pairs}` : '—'}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${r.needs > 0 ? 'text-shell-500' : 'text-ink-500'}`}>
                    {r.needs} of {r.rows}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-700">
                    {from ? `from ${from}` : <span className="text-ink-400">not yet{ready ? ' — looks ready' : ''}</span>}
                  </td>
                  <td className="py-1.5">
                    <input
                      className="field py-1 text-sm"
                      type="date"
                      value={cutover?.perAccount[account.id] ?? ''}
                      onChange={(e) => setAccount(account.id, e.target.value)}
                      aria-label={`Switch-over date for ${account.nickname}`}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {without.length > 0 && (
        <p className="mt-3 text-xs text-ink-400">
          No TD feed, so these stay on Monarch or manual entry: {without.map((a) => a.nickname).join(', ')}. Once Monarch is
          gone, enter their purchases by hand on the Transactions tab.
        </p>
      )}
      <p className="mt-2 text-xs text-ink-400">
        “Looks ready”: at least 85% agreement with Monarch and nothing left needing a look. After the switch-over, review
        new TD rows on the Review tab — rows still uncategorized count as Uncategorized in the budget until you do.
      </p>
    </section>
  )
}
