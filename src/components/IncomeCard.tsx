import { useState } from 'react'
import { money, uid } from '../lib/format'
import type { IncomeLine } from '../lib/types'

interface Props {
  income: IncomeLine[]
  onChange: (income: IncomeLine[]) => void
}

export default function IncomeCard({ income, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const total = income.reduce((s, l) => s + l.amount, 0)

  const update = (id: string, amount: number) =>
    onChange(income.map((l) => (l.id === id ? { ...l, amount: Math.max(0, amount) } : l)))

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
            <div key={line.id} className="flex items-center gap-2">
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
                <input
                  type="number"
                  min={0}
                  value={Math.round(line.amount)}
                  onChange={(e) => update(line.id, Number(e.target.value))}
                  className="field py-1.5 pl-7 text-right text-sm tabular-nums"
                  aria-label={`${line.name} amount`}
                />
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
