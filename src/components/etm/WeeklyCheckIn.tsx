import { useState, type ReactNode } from 'react'
import type { StepState, WeeklySteps } from '../../lib/etm/routine'

const CHIP: Record<StepState, { label: string; className: string }> = {
  done: { label: 'Done', className: 'bg-green-50 text-green-700 ring-green-200' },
  needs: { label: 'Needs you', className: 'bg-shell-50 text-shell-700 ring-shell-200' },
  notNeeded: { label: 'Not needed', className: 'bg-sand-100 text-ink-500 ring-sand-200' },
}

export interface WeeklyStepView {
  key: string
  title: string
  hint: string
  state: StepState
  /** Extra words beside the state, e.g. "12 to file". */
  detail?: string
  body: ReactNode
}

/**
 * The weekly check-in: the routine's steps in order, each saying where it
 * stands. Steps that need you start open; the rest fold away and open on a
 * tap. "Done for this week" starts the next week's check-in from today.
 */
export default function WeeklyCheckIn({
  steps,
  status,
  lastDone,
  onMarkDone,
}: {
  steps: WeeklyStepView[]
  status: WeeklySteps
  lastDone?: string
  onMarkDone: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (step: WeeklyStepView) => open[step.key] ?? step.state === 'needs'
  const allClear = status.needCount === 0

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Weekly check-in</h2>
          <p className="text-sm text-ink-500">
            {allClear
              ? 'Everything is done for this week.'
              : `${status.needCount} ${status.needCount === 1 ? 'step needs' : 'steps need'} you.`}{' '}
            <span className="text-ink-400">
              {lastDone ? `Last check-in finished ${dayLabel(lastDone)}.` : `This week counts from ${dayLabel(status.since)}.`}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onMarkDone}
          className={`${allClear ? 'btn-primary' : 'btn-ghost'} text-xs`}
          title="The next check-in counts from today"
        >
          Done for this week
        </button>
      </div>

      {steps.map((step, index) => (
        <section key={step.key} className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen({ ...open, [step.key]: !isOpen(step) })}
            className="flex w-full items-start gap-3 p-5 text-left"
            aria-expanded={isOpen(step)}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.state === 'needs' ? 'bg-tide-600 text-white' : 'bg-sand-200 text-ink-600'
              }`}
            >
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold tracking-tight text-ink-900">{step.title}</span>
              <span className="block text-sm text-ink-500">{step.hint}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {step.detail && <span className="text-xs text-ink-500">{step.detail}</span>}
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${CHIP[step.state].className}`}>
                {CHIP[step.state].label}
              </span>
              <span className="text-xs text-ink-400">{isOpen(step) ? '▾' : '▸'}</span>
            </span>
          </button>
          {isOpen(step) && <div className="border-t border-sand-200/70 bg-sand-50/40 p-4">{step.body}</div>}
        </section>
      ))}
    </div>
  )
}

const dayLabel = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
