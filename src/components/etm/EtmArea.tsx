import { useState } from 'react'

interface Props {
  onClose: () => void
  onLock: () => void
  onWipe: () => void
}

/**
 * The unlocked module. Empty by design in this first phase: the import
 * pipeline, views, and workflow screen land here in the phases that follow.
 */
export default function EtmArea({ onClose, onLock, onWipe }: Props) {
  const [confirmingWipe, setConfirmingWipe] = useState(false)

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-sand-50 animate-fade">
      <header className="sticky top-0 z-10 border-b border-sand-200/70 bg-sand-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-tide-700">
              Expenses
            </span>
            <span className="block text-[11px] text-ink-400">Unlocked on this device</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onLock} className="btn-quiet text-xs">
              Lock
            </button>
            <button onClick={onClose} className="btn-ghost text-xs">
              Back to budget
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <section className="card p-8">
          <h1 className="text-lg font-semibold leading-snug tracking-tight text-ink-900">
            Nothing here yet
          </h1>
          <p className="mt-1 max-w-prose text-sm text-ink-500">
            This is where your actual spending will live, next to the plan you already keep.
            Bringing in a Monarch export is the next piece to be built; until then the area stays
            empty, and everything it will hold is encrypted with the key you just entered.
          </p>
        </section>

        <section className="mt-6 max-w-xl rounded-2xl border border-shell-300/50 bg-shell-300/10 px-4 py-3.5">
          <p className="text-sm font-medium text-ink-900">Erase expense data</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Removes this device’s encrypted expense store and the key setup along with it. Your
            budget, goals, and profile are untouched.
          </p>
          {confirmingWipe ? (
            <div className="mt-3 flex gap-2">
              <button onClick={onWipe} className="btn bg-shell-500 text-white hover:opacity-90">
                Yes, erase it
              </button>
              <button onClick={() => setConfirmingWipe(false)} className="btn-ghost">
                Keep it
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmingWipe(true)} className="btn-ghost mt-3">
              Erase expense data
            </button>
          )}
        </section>
      </main>
    </div>
  )
}
