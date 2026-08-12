import { useState } from 'react'
import type { GroupSummary } from '../lib/budget'
import { splitForDisplay } from '../lib/budget'
import { money, percent } from '../lib/format'
import type { DashboardActuals } from '../lib/etm/aggregate'

interface Props {
  summaries: GroupSummary[]
  onOpen: (summary: GroupSummary) => void
  /** How many bars fit before the rest is folded into "everything else". */
  visible?: number
  /**
   * Present only while the expense module is unlocked. Type-only, so nothing
   * of that module is reachable from here in a build without it.
   */
  actuals?: DashboardActuals | null
}

export default function GroupBars({ summaries, onOpen, visible = 6, actuals }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { shown, rest, restTotal } = splitForDisplay(summaries, visible)
  // Folds to a constant null in public builds, taking the comparison with it.
  const overlay = __ETM_AVAILABLE__ ? (actuals ?? null) : null
  const months = overlay?.months ?? 1
  const plannedMax = (summaries[0]?.total ?? 1) * months
  const actualMax = overlay ? Math.max(...[...overlay.byGroup.values()].map((m) => m.CAD), 0) : 0
  const max = Math.max(plannedMax, actualMax, 1)

  return (
    <div className="space-y-1">
      {shown.map((s, i) => (
        <Bar
          key={s.group.id}
          summary={s}
          max={max}
          onOpen={onOpen}
          index={i}
          months={months}
          actual={overlay?.byGroup.get(s.group.id) ?? null}
          comparing={Boolean(overlay)}
        />
      ))}

      {rest.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="group flex w-full items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition hover:bg-sand-100/70"
          >
            <span className="w-40 shrink-0 truncate text-sm text-ink-500">
              Everything else
              <span className="ml-1.5 text-xs text-ink-400">({rest.length})</span>
            </span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-sand-200/70">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-ink-400/50"
                style={{ width: `${Math.max(2, ((restTotal * months) / max) * 100)}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-sm tabular-nums text-ink-500">
              {money(restTotal * months)}
            </span>
            <span className="w-5 text-ink-400 transition group-hover:text-ink-700">
              {expanded ? '−' : '+'}
            </span>
          </button>

          {expanded && (
            <div className="mt-1 space-y-1 border-l border-sand-200 pl-3 animate-fade">
              {rest.map((s, i) => (
                <Bar
                  key={s.group.id}
                  summary={s}
                  max={max}
                  onOpen={onOpen}
                  index={i}
                  months={months}
                  actual={overlay?.byGroup.get(s.group.id) ?? null}
                  comparing={Boolean(overlay)}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Bar({
  summary,
  max,
  onOpen,
  index,
  months,
  actual,
  comparing,
  compact = false,
}: {
  summary: GroupSummary
  max: number
  onOpen: (s: GroupSummary) => void
  index: number
  months: number
  actual: { CAD: number; USD: number } | null
  comparing: boolean
  compact?: boolean
}) {
  const planned = summary.total * months
  const width = Math.max(2, (planned / max) * 100)
  const spent = actual?.CAD ?? 0
  const over = comparing && spent > planned

  return (
    <button
      onClick={() => onOpen(summary)}
      className="group flex w-full items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition hover:bg-sand-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-tide-500/30"
      style={{ animation: 'var(--animate-rise)', animationDelay: `${index * 45}ms` }}
      title={`${summary.lines.length} item${summary.lines.length === 1 ? '' : 's'} — click to adjust`}
    >
      <span className="w-40 shrink-0 truncate">
        <span className={`block truncate font-medium text-ink-900 ${compact ? 'text-[13px]' : 'text-sm'}`}>
          {summary.group.name}
        </span>
        {!compact && (
          <span className="block truncate text-[11px] text-ink-400">{summary.group.blurb}</span>
        )}
      </span>

      <span className="flex-1 space-y-1">
        <span className="relative block h-2.5 overflow-hidden rounded-full bg-sand-200/70">
          <span
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{ width: `${width}%`, background: summary.group.color }}
          />
        </span>
        {comparing && (
          <span
            className="relative block h-1.5 overflow-hidden rounded-full bg-sand-200/70"
            title="Actually spent"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(0, Math.min(100, (spent / max) * 100))}%`,
                background: over ? 'var(--color-shell-500)' : 'var(--color-ink-700)',
              }}
            />
          </span>
        )}
      </span>

      <span className={`shrink-0 text-right ${comparing ? 'w-28' : 'w-24'}`}>
        <span className="block text-sm font-semibold tabular-nums text-ink-900">
          {money(planned)}
        </span>
        {comparing ? (
          <>
            <span
              className={`block text-[11px] tabular-nums ${over ? 'text-shell-500' : 'text-ink-500'}`}
            >
              spent {money(spent)}
            </span>
            {actual && actual.USD !== 0 && (
              <span className="block text-[11px] tabular-nums text-tide-700">
                + US${Math.round(Math.abs(actual.USD)).toLocaleString()}
              </span>
            )}
          </>
        ) : (
          <span className="block text-[11px] tabular-nums text-ink-400">
            {percent(summary.share)}
          </span>
        )}
      </span>

      <span className="w-5 text-ink-300 opacity-0 transition group-hover:opacity-100">›</span>
    </button>
  )
}
