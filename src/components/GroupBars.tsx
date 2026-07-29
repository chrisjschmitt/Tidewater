import { useState } from 'react'
import type { GroupSummary } from '../lib/budget'
import { splitForDisplay } from '../lib/budget'
import { money, percent } from '../lib/format'

interface Props {
  summaries: GroupSummary[]
  onOpen: (summary: GroupSummary) => void
  /** How many bars fit before the rest is folded into "everything else". */
  visible?: number
}

export default function GroupBars({ summaries, onOpen, visible = 6 }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { shown, rest, restTotal } = splitForDisplay(summaries, visible)
  const max = summaries[0]?.total ?? 1

  return (
    <div className="space-y-1">
      {shown.map((s, i) => (
        <Bar key={s.group.id} summary={s} max={max} onOpen={onOpen} index={i} />
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
                style={{ width: `${Math.max(2, (restTotal / max) * 100)}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-sm tabular-nums text-ink-500">
              {money(restTotal)}
            </span>
            <span className="w-5 text-ink-400 transition group-hover:text-ink-700">
              {expanded ? '−' : '+'}
            </span>
          </button>

          {expanded && (
            <div className="mt-1 space-y-1 border-l border-sand-200 pl-3 animate-fade">
              {rest.map((s, i) => (
                <Bar key={s.group.id} summary={s} max={max} onOpen={onOpen} index={i} compact />
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
  compact = false,
}: {
  summary: GroupSummary
  max: number
  onOpen: (s: GroupSummary) => void
  index: number
  compact?: boolean
}) {
  const width = Math.max(2, (summary.total / max) * 100)
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

      <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-sand-200/70">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${width}%`, background: summary.group.color }}
        />
      </span>

      <span className="w-24 shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-ink-900">
          {money(summary.total)}
        </span>
        <span className="block text-[11px] tabular-nums text-ink-400">{percent(summary.share)}</span>
      </span>

      <span className="w-5 text-ink-300 opacity-0 transition group-hover:opacity-100">›</span>
    </button>
  )
}
