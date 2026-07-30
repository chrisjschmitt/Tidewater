export interface ImportProgressState {
  fileName: string
  /** Short status line, e.g. "Reading your file…" */
  label: string
  /** 0–100 */
  percent: number
}

interface Props {
  progress: ImportProgressState
}

/** Calm full-screen progress while a large import is read and averaged. */
export default function ImportProgress({ progress }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.percent)))

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-sand-50/80 p-6 backdrop-blur-[2px] animate-fade"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`${progress.label} ${pct} percent`}
    >
      <div className="w-full max-w-md rounded-2xl bg-white/90 px-6 py-5 shadow-lg shadow-ink-900/5">
        <p className="text-sm font-medium text-ink-900">{progress.label}</p>
        <p className="mt-1 truncate text-xs text-ink-400" title={progress.fileName}>
          {progress.fileName}
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-sand-200">
          <div
            className="h-full rounded-full bg-tide-600 transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-right text-[11px] tabular-nums text-ink-400">{pct}%</p>
      </div>
    </div>
  )
}
