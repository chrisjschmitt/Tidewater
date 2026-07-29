import { useEffect, useState } from 'react'
import type { GroupSummary } from '../lib/budget'
import { money, uid } from '../lib/format'
import type { ExpenseLine } from '../lib/types'
import AmountInput from './AmountInput'
import Modal from './Modal'

interface Props {
  summary: GroupSummary | null
  /** Money left over across the whole plan, so changes can be felt immediately. */
  unallocated: number
  onClose: () => void
  onChange: (lines: ExpenseLine[]) => void
}

const ROUND_STEPS = [1, 1.5, 2, 3, 5, 7.5]

/**
 * Slider ceiling: the next round number above the line's baseline, with room
 * left to raise it. Round numbers so the end of the track is a figure you can
 * recognise, since each line is drawn to its own scale.
 */
function ceilingFor(baseline: number): number {
  const target = Math.max(50, baseline * 1.5)
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const step = ROUND_STEPS.find((m) => magnitude * m >= target)
  return Math.round(magnitude * (step ?? 10))
}

/**
 * What the slider is drawn around. A line you just added has no amount yet, so
 * fall back to the middle of the group — one large line such as rent should
 * not set the scale for a cable bill sitting beside it.
 */
function baselineFor(line: ExpenseLine, lines: ExpenseLine[]): number {
  const known = line.baseline ?? line.observed ?? line.amount
  if (known > 0) return known

  const others = lines
    .filter((l) => l.id !== line.id && l.amount > 0)
    .map((l) => l.amount)
    .sort((a, b) => a - b)
  return others.length > 0 ? others[Math.floor(others.length / 2)] : 100
}

/**
 * Nudge by an amount that suits the size of the line: a dollar at a time is
 * uselessly slow on rent, and $25 is too coarse for a streaming subscription.
 * Derived from the frozen ceiling so it does not change mid-drag.
 */
const stepFor = (ceiling: number) =>
  ceiling >= 3000 ? 50 : ceiling >= 1600 ? 25 : ceiling >= 600 ? 10 : ceiling >= 120 ? 5 : 1

interface Session {
  groupId: string
  /** Group total when the modal opened, for the "this session" comparison. */
  total: number
  /** Frozen per line, so an adjustment cannot move the track it is made on. */
  baselines: Record<string, number>
}

export default function GroupDetail({ summary, unallocated, onClose, onChange }: Props) {
  const [draftName, setDraftName] = useState('')
  const [addedId, setAddedId] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!summary) {
      setSession(null)
      return
    }
    const { group, lines } = summary
    setSession((prev) => {
      if (prev?.groupId !== group.id) {
        return {
          groupId: group.id,
          total: lines.reduce((s, l) => s + l.amount, 0),
          baselines: Object.fromEntries(lines.map((l) => [l.id, baselineFor(l, lines)])),
        }
      }

      // Take in lines added since opening, and any baseline that a typed
      // amount has since pushed wider. Everything else is left alone.
      const baselines = { ...prev.baselines }
      let changed = false
      for (const line of lines) {
        const want = line.baseline ?? baselines[line.id] ?? baselineFor(line, lines)
        if (baselines[line.id] !== want) {
          baselines[line.id] = want
          changed = true
        }
      }
      return changed ? { ...prev, baselines } : prev
    })
  }, [summary])

  if (!summary) return null
  const { group, lines } = summary
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const delta = session?.groupId === group.id ? total - session.total : 0

  const update = (id: string, amount: number) => {
    const baseline = session?.baselines[id]
    onChange(
      lines.map((l) => {
        if (l.id !== id) return l
        const next = Math.max(0, Math.round(amount))
        const from = baseline ?? baselineFor(l, lines)
        return {
          ...l,
          amount: next,
          // Record the baseline on first touch so the track stops rescaling
          // between visits, and widen it if a typed amount runs off the end.
          baseline: next > ceilingFor(from) ? next : (l.baseline ?? from),
        }
      }),
    )
  }

  const remove = (id: string) => onChange(lines.filter((l) => l.id !== id))

  const add = () => {
    const name = draftName.trim()
    if (!name) return
    const line: ExpenseLine = {
      id: uid('exp'),
      name,
      groupId: group.id,
      amount: 0,
      baseline: baselineFor({ id: '', name, groupId: group.id, amount: 0, essential: false }, lines),
      essential: false,
    }
    onChange([...lines, line])
    setAddedId(line.id)
    setDraftName('')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={group.name}
      subtitle={group.blurb}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-500">
            Group total{' '}
            <span className="font-semibold text-ink-900">{money(total)}</span>
            {Math.abs(delta) >= 1 && (
              <span className={delta > 0 ? 'ml-2 text-shell-500' : 'ml-2 text-tide-600'}>
                {delta > 0 ? '+' : '−'}
                {money(Math.abs(delta))} this session
              </span>
            )}
          </div>
          <div className="text-sm text-ink-500">
            Unspoken for{' '}
            <span
              className={`font-semibold ${unallocated < 0 ? 'text-shell-500' : 'text-tide-600'}`}
            >
              {money(unallocated)}
            </span>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {lines.length === 0 && (
          <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-ink-500">
            Nothing here yet. Add the first item below.
          </p>
        )}

        {lines.map((line) => {
          const ceiling = ceilingFor(session?.baselines[line.id] ?? baselineFor(line, lines))
          const step = stepFor(ceiling)
          const fill = Math.min(100, (line.amount / Math.max(ceiling, 1)) * 100)
          const nudge = (direction: 1 | -1) =>
            update(line.id, Math.round(line.amount / step) * step + direction * step)
          return (
            <div key={line.id} className="rounded-2xl bg-white/70 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{line.name}</p>
                  {line.essential ? (
                    <p className="text-[11px] text-ink-400">Hard to move — that is fine</p>
                  ) : line.observed ? (
                    <p className="text-[11px] text-ink-400">
                      Recently averaging {money(line.observed)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-ink-400">Flexible</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Nudge
                    label={`Decrease ${line.name} by $${step}`}
                    disabled={line.amount <= 0}
                    onClick={() => nudge(-1)}
                  >
                    −
                  </Nudge>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                      $
                    </span>
                    <AmountInput
                      value={line.amount}
                      onChange={(v) => update(line.id, v)}
                      className="field w-24 pl-7 pr-2 text-right tabular-nums"
                      ariaLabel={`${line.name} monthly amount`}
                      autoFocus={line.id === addedId}
                    />
                  </div>
                  <Nudge label={`Increase ${line.name} by $${step}`} onClick={() => nudge(1)}>
                    +
                  </Nudge>
                  <button
                    onClick={() => remove(line.id)}
                    aria-label={`Remove ${line.name}`}
                    className="rounded-full p-1.5 text-ink-300 transition hover:bg-sand-100 hover:text-shell-500"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={ceiling}
                  step={step}
                  value={Math.min(line.amount, ceiling)}
                  onChange={(e) => update(line.id, Number(e.target.value))}
                  aria-label={`Adjust ${line.name}`}
                  className="flex-1"
                  style={
                    {
                      '--thumb': group.color,
                      '--track': `linear-gradient(to right, ${group.color} ${fill}%, var(--color-sand-200) ${fill}%)`,
                    } as React.CSSProperties
                  }
                />
                {/* Each line is drawn to its own scale, so say where it ends. */}
                <span className="shrink-0 text-[10px] tabular-nums text-ink-300">
                  {money(ceiling)}
                </span>
              </div>
            </div>
          )
        })}

        <div className="flex gap-2 pt-1">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={`Add something to ${group.name.toLowerCase()}`}
            className="field flex-1"
          />
          <button onClick={add} disabled={!draftName.trim()} className="btn-ghost">
            Add
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Nudge({
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
      title={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sand-300 text-sm text-ink-700 transition hover:bg-sand-100 disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
