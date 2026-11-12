import { useEffect, useRef } from 'react'
import { idleExpired, writeLastActive } from '../../lib/etm/lockTimes'

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
const CHECK_MS = 30_000
/** How often a burst of activity is written down for the next open (closing the app counts as idle). */
const WRITE_MS = 30_000

/**
 * Locks the vault after 15 minutes without a tap, click, key or scroll
 * anywhere in Tidewater. Checked every 30 seconds and whenever the app comes
 * back into view, so a Mac or iPad waking from sleep locks at once.
 */
export function useIdleLock(onIdle: () => void): void {
  const last = useRef(Date.now())
  const written = useRef(0)
  const idle = useRef(onIdle)
  idle.current = onIdle

  useEffect(() => {
    let fired = false
    const now = Date.now()
    last.current = now
    written.current = now
    writeLastActive(new Date(now))

    const lockIfIdle = () => {
      if (fired || !idleExpired(last.current)) return
      fired = true
      idle.current()
    }
    const onActivity = () => {
      // Activity after the limit doesn't reopen the vault: the check comes first.
      lockIfIdle()
      if (fired) return
      const at = Date.now()
      last.current = at
      if (at - written.current >= WRITE_MS) {
        written.current = at
        writeLastActive(new Date(at))
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') lockIfIdle()
    }

    for (const type of ACTIVITY) window.addEventListener(type, onActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(lockIfIdle, CHECK_MS)
    return () => {
      for (const type of ACTIVITY) window.removeEventListener(type, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])
}
