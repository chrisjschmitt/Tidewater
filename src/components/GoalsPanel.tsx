import { useMemo, useRef, useState } from 'react'
import { money, monthsToText, uid } from '../lib/format'
import { interestOverHorizon, monthsToTarget, progressToward } from '../lib/goals'
import type { Goal, GoalKind } from '../lib/types'
import AmountInput from './AmountInput'
import GoalChart from './GoalChart'
import Modal from './Modal'

interface Props {
  goals: Goal[]
  /** Money not yet committed, shown so the surplus is easy to read. */
  available: number
  /**
   * Income less everyday spending. Contribution ranges are sized from this
   * rather than from a goal's own amount, which keeps the sliders stable.
   */
  capacity: number
  onChange: (goals: Goal[]) => void
}

const HORIZONS = [
  { label: '1 yr', months: 12 },
  { label: '5 yrs', months: 60 },
  { label: '10 yrs', months: 120 },
  { label: '25 yrs', months: 300 },
  { label: '35 yrs', months: 420 },
]

const DEFAULT_HORIZON = 120

const PRESETS: Array<{
  name: string
  kind: GoalKind
  target: number
  rate: number
  horizon: number
  blurb: string
}> = [
  { name: 'RRSP', kind: 'savings', target: 100000, rate: 5, horizon: 420, blurb: 'Retirement, quietly compounding' },
  { name: 'First home down payment', kind: 'savings', target: 60000, rate: 3.75, horizon: 120, blurb: 'A place of your own' },
  { name: 'Vacation', kind: 'savings', target: 5000, rate: 3.5, horizon: 60, blurb: 'Somewhere you have been meaning to go' },
  { name: 'New car', kind: 'savings', target: 25000, rate: 3.5, horizon: 60, blurb: 'Without the loan' },
  { name: 'Emergency fund', kind: 'savings', target: 15000, rate: 3.5, horizon: 60, blurb: 'Three months of ease' },
  { name: 'Credit card', kind: 'debt', target: 0, rate: 19.99, horizon: 60, blurb: 'Pay it down and be done' },
]

export default function GoalsPanel({ goals, available, capacity, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  /** Null until the user picks "Something else" and is naming their own goal. */
  const [customName, setCustomName] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Goal>) =>
    onChange(goals.map((g) => (g.id === id ? { ...g, ...patch } : g)))

  const remove = (id: string) => onChange(goals.filter((g) => g.id !== id))

  const closeAdd = () => {
    setAdding(false)
    setCustomName(null)
  }

  const addGoal = (preset: (typeof PRESETS)[number]) => {
    const monthly = preset.kind === 'debt' ? 250 : Math.max(50, Math.round(Math.max(available, 100) / 2 / 25) * 25)
    onChange([
      ...goals,
      {
        id: uid('goal'),
        name: preset.name,
        kind: preset.kind,
        target: preset.target,
        current: preset.kind === 'debt' ? 5000 : 0,
        monthly,
        annualRate: preset.rate,
        horizonMonths: preset.horizon,
      },
    ])
    closeAdd()
  }

  const addCustom = () => {
    const name = customName?.trim()
    if (!name) return
    addGoal({ name, kind: 'savings', target: 10000, rate: 3.5, horizon: DEFAULT_HORIZON, blurb: '' })
  }

  return (
    <section className="card p-6">
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">
          What your surplus could become
        </h2>
        <p className="mt-0.5 text-sm text-ink-500">
          {available >= 0
            ? `${money(available)} a month is still unclaimed.`
            : `Your goals currently ask for ${money(Math.abs(available))} more than you have.`}
        </p>
      </header>

      {goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sand-300 px-6 py-10 text-center">
          <p className="text-sm text-ink-500">
            Nothing set aside yet. Name one thing you would like your money to turn into.
          </p>
          <button onClick={() => setAdding(true)} className="btn-primary mt-4">
            Add a goal
          </button>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              capacity={capacity}
              onChange={(patch) => update(goal.id, patch)}
              onRemove={() => remove(goal.id)}
            />
          ))}

          <button
            onClick={() => setAdding(true)}
            className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-sand-300 text-sm text-ink-500 transition hover:border-tide-300 hover:bg-tide-50/40 hover:text-tide-700"
          >
            + Add another goal
          </button>
        </div>
      )}

      <Modal
        open={adding}
        onClose={closeAdd}
        title={customName === null ? 'What would you like to work toward?' : 'Name this goal'}
        subtitle={
          customName === null
            ? 'Pick a starting point — every number stays adjustable.'
            : 'Call it whatever matters to you. You can rename it later.'
        }
        width="max-w-xl"
      >
        {customName === null ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => addGoal(p)}
                className="rounded-2xl border border-sand-200 bg-white/70 px-4 py-3 text-left transition hover:border-tide-300 hover:bg-tide-50/50"
              >
                <span className="block text-sm font-medium text-ink-900">{p.name}</span>
                <span className="block text-xs text-ink-400">{p.blurb}</span>
              </button>
            ))}
            <button
              onClick={() => setCustomName('')}
              className="rounded-2xl border border-sand-200 bg-white/70 px-4 py-3 text-left transition hover:border-tide-300 hover:bg-tide-50/50 sm:col-span-2"
            >
              <span className="block text-sm font-medium text-ink-900">Something else</span>
              <span className="block text-xs text-ink-400">Name it yourself</span>
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              addCustom()
            }}
            className="space-y-4"
          >
            <label className="block">
              <span className="label">Goal name</span>
              <input
                autoFocus
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Trip to Japan, Studio renovation"
                className="field mt-1.5"
                aria-label="Goal name"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCustomName(null)} className="btn-quiet">
                Back
              </button>
              <button type="submit" disabled={!customName.trim()} className="btn-primary">
                Add goal
              </button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  )
}

function GoalCard({
  goal,
  capacity,
  onChange,
  onRemove,
}: {
  goal: Goal
  capacity: number
  onChange: (patch: Partial<Goal>) => void
  onRemove: () => void
}) {
  const isDebt = goal.kind === 'debt'
  const horizon = goal.horizonMonths ?? DEFAULT_HORIZON
  const months = monthsToTarget(goal)
  const interest = interestOverHorizon(goal, horizon)
  const progress = progressToward(goal)
  const color = isDebt ? 'var(--color-shell-500)' : 'var(--color-tide-600)'

  /**
   * The contribution range comes from what your budget can actually spare, not
   * from the current contribution. Deriving it from the live value moves the
   * ceiling as you drag, so the thumb runs away from the pointer.
   */
  const startingMonthly = useRef(goal.monthly)
  const contributionMax = useMemo(
    () => Math.max(500, Math.ceil(Math.max(capacity, startingMonthly.current * 1.5) / 100) * 100),
    [capacity],
  )
  const contributionStep = contributionMax >= 2000 ? 50 : contributionMax >= 1000 ? 25 : 10
  const rateMax = isDebt ? 30 : 12

  return (
    <article className="rounded-2xl bg-white/70 p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <input
            value={goal.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full truncate border-none bg-transparent p-0 text-sm font-semibold text-ink-900 focus:outline-none focus:ring-0"
            aria-label="Goal name"
            title="Click to rename"
          />
          <p className="mt-0.5 text-xs text-ink-500">
            {isDebt ? (
              Number.isFinite(months) ? (
                <>Clear in {monthsToText(months)} · {money(interest)} interest</>
              ) : (
                <>This payment does not yet cover the interest</>
              )
            ) : Number.isFinite(months) ? (
              <>
                {money(goal.target)} in {monthsToText(months)} · {money(interest)} of it is growth
              </>
            ) : (
              <>Not reached within 40 years at this pace</>
            )}
          </p>
        </div>
        <button
          onClick={onRemove}
          aria-label={`Remove ${goal.name}`}
          className="rounded-full p-1 text-ink-300 transition hover:bg-sand-100 hover:text-shell-500"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div
        className="mb-3 flex flex-wrap items-center gap-0.5 rounded-full bg-sand-100 p-0.5"
        role="group"
        aria-label={`Time scale for ${goal.name}`}
      >
        {HORIZONS.map((h) => (
          <button
            key={h.months}
            onClick={() => onChange({ horizonMonths: h.months })}
            className={`flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition ${
              horizon === h.months ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>

      {!isDebt && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-sand-200">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(1, progress * 100)}%`, background: color }}
          />
        </div>
      )}

      <GoalChart goal={goal} months={horizon} color={color} />

      <div className="mt-4 space-y-3">
        <Adjuster
          label={isDebt ? 'Monthly payment' : 'Monthly contribution'}
          value={goal.monthly}
          min={0}
          max={contributionMax}
          step={contributionStep}
          unit="money"
          color={color}
          onChange={(v) => onChange({ monthly: v })}
        />
        <Adjuster
          label={isDebt ? 'Interest rate' : 'Assumed annual return'}
          value={goal.annualRate}
          min={0}
          max={rateMax}
          step={0.25}
          unit="percent"
          color={color}
          onChange={(v) => onChange({ annualRate: v })}
        />

        <div className="grid grid-cols-2 gap-3 pt-1">
          <Field
            label={isDebt ? 'Balance owing' : 'Saved so far'}
            value={goal.current}
            onChange={(v) => onChange({ current: v })}
          />
          {!isDebt && (
            <Field label="Target" value={goal.target} onChange={(v) => onChange({ target: v })} />
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * Three ways to set one number: nudge it a step at a time, type it exactly, or
 * drag. The range is fixed by the caller so dragging stays predictable.
 */
function Adjuster({
  label,
  value,
  min,
  max,
  step,
  unit,
  color,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: 'money' | 'percent'
  color: string
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  // Snap to the step grid so nudging never leaves an odd trailing amount.
  const nudge = (direction: 1 | -1) => {
    const next = Math.round(value / step) * step + direction * step
    onChange(clamp(Number(next.toFixed(2))))
  }

  const commit = (text: string) => {
    setDraft(null)
    const parsed = Number.parseFloat(text.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
  }

  const shown = unit === 'money' ? String(Math.round(value)) : value.toFixed(2)
  const fill = ((clamp(value) - min) / Math.max(1e-6, max - min)) * 100

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500">{label}</span>

        <div className="flex items-center gap-1">
          <StepButton
            label={`Decrease ${label}`}
            disabled={value <= min}
            onClick={() => nudge(-1)}
          >
            −
          </StepButton>

          <div className="relative w-[86px]">
            {unit === 'money' && (
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-400">
                $
              </span>
            )}
            <input
              inputMode="decimal"
              value={draft ?? shown}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  nudge(1)
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  nudge(-1)
                }
              }}
              aria-label={label}
              className={`field py-1 text-right text-sm font-semibold tabular-nums ${
                unit === 'money' ? 'pl-6 pr-2' : 'pl-2 pr-6'
              }`}
            />
            {unit === 'percent' && (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-400">
                %
              </span>
            )}
          </div>

          <StepButton label={`Increase ${label}`} disabled={value >= max} onClick={() => nudge(1)}>
            +
          </StepButton>
        </div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} slider`}
        style={
          {
            '--thumb': color,
            '--track': `linear-gradient(to right, ${color} ${fill}%, var(--color-sand-200) ${fill}%)`,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sand-300 text-sm text-ink-700 transition hover:bg-sand-100 disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <span className="text-xs text-ink-500">{label}</span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
          $
        </span>
        <AmountInput
          value={value}
          onChange={onChange}
          className="field w-full pl-7 tabular-nums"
          ariaLabel={label}
        />
      </div>
    </div>
  )
}
