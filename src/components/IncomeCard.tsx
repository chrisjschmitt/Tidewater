import { useState } from 'react'
import { lineAmountIn, paydaysIn, perPaymentFor, scheduleLabel, scheduleWeeks, withEveryTwoWeeks } from '../lib/budget'
import { money, uid } from '../lib/format'
import type { IncomeLine } from '../lib/types'

interface Props {
  income: IncomeLine[]
  onChange: (income: IncomeLine[]) => void
}

export default function IncomeCard({ income, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const thisMonth = localToday().slice(0, 7)
  // This month as it falls: pay every two weeks counts this month's paydays.
  const total = income.reduce((s, l) => s + lineAmountIn(l, thisMonth), 0)

  const update = (id: string, amount: number) =>
    onChange(income.map((l) => (l.id === id ? { ...l, amount: Math.max(0, amount) } : l)))
  const setSchedule = (id: string, schedule: { perPayment: number; firstPayday: string; weeks?: number } | null) =>
    onChange(income.map((l) => (l.id === id ? withEveryTwoWeeks(l, schedule) : l)))
  const today = localToday()

  return (
    <section className="card p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-ink-900">What arrives</h2>
          <p className="text-xs text-ink-400">
            {income.length} source{income.length === 1 ? '' : 's'} each month
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tabular-nums text-tide-700">{money(total)}</span>
          <span className="text-ink-400">{open ? '−' : '+'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-2 animate-fade">
          {income.map((line) => (
            <div key={line.id}>
            <div className="flex items-center gap-2">
              <input
                value={line.name}
                onChange={(e) =>
                  onChange(income.map((l) => (l.id === line.id ? { ...l, name: e.target.value } : l)))
                }
                className="field flex-1 py-1.5 text-sm"
              />
              <div className="relative w-32">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                  $
                </span>
                {line.everyTwoWeeks ? (
                  <input
                    type="number"
                    min={0}
                    value={Math.round(line.everyTwoWeeks.perPayment)}
                    onChange={(e) =>
                      setSchedule(line.id, { ...line.everyTwoWeeks!, perPayment: Math.max(0, Number(e.target.value)) })
                    }
                    className="field py-1.5 pl-7 text-right text-sm tabular-nums"
                    aria-label={`${line.name} amount per payday`}
                  />
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={Math.round(line.amount)}
                    onChange={(e) => update(line.id, Number(e.target.value))}
                    className="field py-1.5 pl-7 text-right text-sm tabular-nums"
                    aria-label={`${line.name} amount`}
                  />
                )}
              </div>
              <button
                onClick={() => onChange(income.filter((l) => l.id !== line.id))}
                aria-label={`Remove ${line.name}`}
                className="rounded-full p-1 text-ink-300 transition hover:text-shell-500"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {line.everyTwoWeeks ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 pl-1 text-[11px] text-ink-400">
                <span>
                  {scheduleLabel(line.everyTwoWeeks)} · {paydaysIn(line.everyTwoWeeks, thisMonth)} payday
                  {paydaysIn(line.everyTwoWeeks, thisMonth) === 1 ? '' : 's'} this month (
                  {money(lineAmountIn(line, thisMonth))}) · about {money(line.amount)} in an average month
                </span>
                <label className="flex items-center gap-1">
                  every
                  <select
                    className="field py-0.5 text-xs"
                    value={scheduleWeeks(line.everyTwoWeeks)}
                    onChange={(e) => {
                      const weeks = Number(e.target.value)
                      setSchedule(line.id, { ...line.everyTwoWeeks!, weeks, perPayment: perPaymentFor(line.amount, weeks) })
                    }}
                    aria-label={`Weeks between ${line.name} paydays`}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'week' : `${n} weeks`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  a payday
                  <input
                    type="date"
                    className="field py-0.5 text-xs"
                    value={line.everyTwoWeeks.firstPayday}
                    onChange={(e) =>
                      e.target.value && setSchedule(line.id, { ...line.everyTwoWeeks!, firstPayday: e.target.value })
                    }
                  />
                </label>
                <button className="underline decoration-dotted underline-offset-4" onClick={() => setSchedule(line.id, null)}>
                  Monthly instead
                </button>
              </div>
            ) : (
              <button
                className="mt-0.5 pl-1 text-[11px] text-ink-400 underline decoration-dotted underline-offset-4 hover:text-ink-700"
                onClick={() => setSchedule(line.id, { perPayment: perPaymentFor(line.amount, 2), firstPayday: today })}
                title="For pay that arrives every few weeks"
              >
                Paid every few weeks?
              </button>
            )}
            </div>
          ))}

          <button
            onClick={() =>
              onChange([...income, { id: uid('inc'), name: 'Other income', amount: 0 }])
            }
            className="btn-quiet w-full justify-start px-2 text-xs"
          >
            + Add a source
          </button>
        </div>
      )}
    </section>
  )
}

/** Today's local date, `YYYY-MM-DD`. */
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
