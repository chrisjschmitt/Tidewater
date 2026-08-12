import PeriodSelector from './PeriodSelector'
import { presentIn, type Money } from '../../lib/etm/aggregate'
import { amountIn } from '../../lib/etm/format'
import type { Period } from '../../lib/etm/period'

interface Props {
  period: Period
  months: string[]
  income: Money
  spend: Money
  /** Named rather than folded in, so "Out" cannot be read as everything. */
  reimbursable: Money
  counted: number
  loading: boolean
  onPeriodChange: (period: Period) => void
  onOpen: () => void
}

/**
 * The one line the dashboard gains while the module is unlocked: which period
 * everything is being read through, and what actually happened in it. The
 * comparison itself sits on the bars and the ring below.
 */
export default function EtmStrip({
  period,
  months,
  income,
  spend,
  reimbursable,
  counted,
  loading,
  onPeriodChange,
  onOpen,
}: Props) {
  const advances = presentIn(reimbursable)

  return (
    <section className="card mb-6 flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 animate-fade">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-tide-700">
          Actual
        </span>
        <PeriodSelector period={period} months={months} onChange={onPeriodChange} />
      </div>

      <div className="flex flex-wrap items-center gap-5">
        {loading ? (
          <span className="text-xs text-ink-400">Decrypting…</span>
        ) : (
          <>
            <Figure label="In" money={income} />
            <Figure label="Out" money={spend} />
            <span className="text-xs text-ink-400">
              {counted.toLocaleString()} transaction{counted === 1 ? '' : 's'}
            </span>
            {advances.length > 0 && (
              <span className="text-xs text-ink-400">
                plus{' '}
                {advances
                  .map(([currency, value]) => amountIn(Math.abs(value), currency))
                  .join(' · ')}{' '}
                reimbursable, kept out
              </span>
            )}
          </>
        )}
        <button onClick={onOpen} className="btn-ghost text-xs">
          Open expenses
        </button>
      </div>
    </section>
  )
}

function Figure({ label, money }: { label: string; money: Money }) {
  const parts = presentIn(money)
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-ink-400">{label}</span>
      {parts.length === 0 ? (
        <span className="text-sm text-ink-400">—</span>
      ) : (
        parts.map(([currency, value]) => (
          <span key={currency} className="text-sm font-semibold tabular-nums text-ink-900">
            {amountIn(Math.abs(value), currency)}
            {parts.length > 1 && (
              <span className="ml-0.5 text-[10px] font-normal text-ink-400">{currency}</span>
            )}
          </span>
        ))
      )}
    </span>
  )
}
