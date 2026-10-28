import { useMemo, useState } from 'react'
import { amountIn } from '../../lib/etm/format'
import type { EtmConfig } from '../../lib/etm/config'
import { monthName } from '../../lib/etm/period'
import { settleUp, type AccountLine } from '../../lib/etm/settleUp'
import type { Account, Transaction } from '../../lib/etm/types'

/**
 * Reimbursable → Settle up: for one month, what is owed back and to which
 * account, what was charged to the holder's own accounts (to pay on a card,
 * already paid from a bank account), and — once the month's reimbursement
 * day is recorded — what has come in since and is still to reimburse.
 */
export default function SettleUpCard({
  accounts,
  transactions,
  month,
  config,
  onConfigChange,
}: {
  accounts: Account[]
  transactions: Transaction[]
  month: string
  config: EtmConfig
  onConfigChange: (config: EtmConfig) => void
}) {
  const result = useMemo(
    () => settleUp(transactions, accounts, month, config.reimbursedOn, config.reimbursableTag),
    [transactions, accounts, month, config.reimbursedOn, config.reimbursableTag],
  )
  const [showOpen, setShowOpen] = useState(false)
  const day = result.reimbursedOn
  const setDay = (value: string | undefined) => {
    const next = { ...(config.reimbursedOn ?? {}) }
    if (value) next[month] = value
    else delete next[month]
    onConfigChange({ ...config, reimbursedOn: next })
  }
  const total = (lines: AccountLine[]) => lines.reduce((sum, l) => sum + l.amount, 0)
  // Local day, so an evening reimbursement isn't recorded as tomorrow.
  const now = new Date()
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const openRows = result.owedRows.filter((r) => r.state !== 'covered')
  const carried = openRows.filter((r) => r.state === 'carried')

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Settle up · {monthName(month)}</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        What is owed back, to which account, and what is on your own accounts. Reimbursements are made a few days before
        month end; record the day and anything charged after it shows here as still to reimburse — carried into next
        month if it isn’t settled by then.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-700">Reimbursed on</span>
        <input
          type="date"
          className="field py-1 text-sm"
          value={day ?? ''}
          max={todayIso}
          onChange={(e) => setDay(e.target.value || undefined)}
        />
        {!day && todayIso.slice(0, 7) === month && (
          <button className="btn-ghost text-xs" onClick={() => setDay(todayIso)}>
            Reimbursed today
          </button>
        )}
        {day && (
          <button className="btn-quiet text-xs" onClick={() => setDay(undefined)}>
            Clear
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-white/70 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            {day ? `Still to reimburse — since ${day}` : 'Owed back'}, by the account that paid
          </p>
          <Lines lines={result.owedByAccount} empty={day ? 'Nothing since — all settled.' : 'Nothing owed this month.'} />
          {result.owedByAccount.length > 0 && (
            <p className="mt-1 text-right text-sm font-semibold tabular-nums text-ink-900">
              {amountIn(total(result.owedByAccount), 'CAD')}
            </p>
          )}
          {carried.length > 0 && (
            <p className="mt-1 text-[11px] text-ink-400">
              Includes {carried.length} from last month, after its reimbursement.
            </p>
          )}
          {openRows.length > 0 && (
            <button className="btn-quiet mt-1 text-xs" onClick={() => setShowOpen(!showOpen)}>
              {showOpen ? 'Hide' : 'Show'} the {openRows.length} transaction{openRows.length === 1 ? '' : 's'}
            </button>
          )}
          {showOpen && (
            <ul className="mt-1 divide-y divide-sand-200/80 text-xs">
              {openRows
                .slice()
                .sort((a, z) => a.transaction.date.localeCompare(z.transaction.date))
                .map(({ transaction: t, bucket, state }) => (
                  <li key={t.id} className="flex justify-between gap-3 py-1">
                    <span className="min-w-0 truncate text-ink-700">
                      <span className="tabular-nums text-ink-400">{t.date}</span> · {t.merchant} · {bucket}
                      {state === 'carried' && <span className="text-ink-400"> · from last month</span>}
                    </span>
                    <span className="tabular-nums text-ink-700">{amountIn(-t.amount, 'CAD')}</span>
                  </li>
                ))}
            </ul>
          )}
          {day && result.coveredByAccount.length > 0 && (
            <p className="mt-2 border-t border-sand-200 pt-2 text-[11px] text-ink-400">
              Covered by the {day} reimbursement:{' '}
              {result.coveredByAccount.map((l) => `${l.account.nickname} ${amountIn(l.amount, 'CAD')}`).join(' · ')}
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white/70 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">On your own accounts — not owed</p>
          {result.ownByAccount.length === 0 ? (
            <p className="mt-1 text-sm text-ink-500">Nothing this month.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {result.ownByAccount.map((l) => (
                <li key={l.account.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-ink-700">{l.account.nickname}</span>
                  <span className="shrink-0 tabular-nums text-ink-900">
                    {amountIn(l.amount, 'CAD')}{' '}
                    <span className="text-[11px] text-ink-400">
                      {l.account.kind === 'credit' ? 'to pay on this card' : 'already paid from this account'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink-400">
            Charges on an account kept out of the family budget are settled on that account. If something here was
            paid from your own money and nobody owes it, it needn’t carry a reimbursable tag at all.
          </p>
        </div>
      </div>
    </section>
  )
}

function Lines({ lines, empty }: { lines: AccountLine[]; empty: string }) {
  if (lines.length === 0) return <p className="mt-1 text-sm text-ink-500">{empty}</p>
  return (
    <ul className="mt-1 space-y-1 text-sm">
      {lines.map((l) => (
        <li key={l.account.id} className="flex justify-between gap-3">
          <span className="min-w-0 truncate text-ink-700">
            {l.account.nickname}
            <span className="text-[11px] text-ink-400"> · {l.count}</span>
          </span>
          <span className="shrink-0 tabular-nums text-ink-900">{amountIn(l.amount, 'CAD')}</span>
        </li>
      ))}
    </ul>
  )
}
