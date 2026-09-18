import type { HaltRequest } from './halt.js'
import type { PacingConfig, PacingRange } from './types.js'

/**
 * Think time between actions.
 *
 * A person exporting nine accounts reads the page, finds the link, and clicks —
 * several seconds a step, never the same interval twice. This module makes the
 * run move at that speed, for two plain reasons: a burst of instant clicks is
 * the kind of traffic that earns a CAPTCHA, and a run you can actually watch is
 * one you can stop when it does something you did not expect.
 *
 * What this is **not**: it is not evasion. Nothing here disguises the browser
 * or hides that Playwright is driving it — the connection is CDP to the user's
 * own Chrome and `navigator.webdriver` stays exactly as Chrome reports it. If a
 * CAPTCHA appears anyway, the session guard stops the run and hands the problem
 * back to a human. Slowing down is politeness, not camouflage.
 *
 * Every delay is interruptible. Ctrl+C during a ten-second pause stops then,
 * not ten seconds later.
 */

/** Between individual actions: a navigation, a click, a dropdown choice. */
export const DEFAULT_ACTION_DELAY: PacingRange = { minMs: 1_500, maxMs: 4_000 }

/**
 * Between accounts, deliberately longer. This is the seam where a person would
 * glance at what just downloaded before starting the next one.
 */
export const DEFAULT_ACCOUNT_DELAY: PacingRange = { minMs: 4_000, maxMs: 10_000 }

export const DEFAULT_PACING: PacingConfig = {
  actionDelayMs: DEFAULT_ACTION_DELAY,
  accountDelayMs: DEFAULT_ACCOUNT_DELAY,
}

export class Pacer {
  constructor(
    private readonly pacing: PacingConfig,
    private readonly halt: HaltRequest,
  ) {}

  /** Called before every navigation and every export step. */
  async beforeAction(): Promise<void> {
    await this.pause(this.pacing.actionDelayMs)
  }

  /**
   * Called at the between-account checkpoint. Returns how long it actually
   * waited so the run log can say so — a pause with no explanation looks like
   * the tool has hung.
   */
  async betweenAccounts(): Promise<number> {
    const ms = pickDelay(this.pacing.accountDelayMs)
    await this.sleep(ms)
    return ms
  }

  private async pause(range: PacingRange): Promise<void> {
    await this.sleep(pickDelay(range))
  }

  /**
   * Sleeps, unless a halt has been asked for — in which case it returns at once
   * and lets the caller reach its next checkpoint.
   */
  private async sleep(ms: number): Promise<void> {
    if (this.halt.requested) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      void this.halt.signal.then(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

/** Uniform across the range, so no two runs share a rhythm. */
export function pickDelay(range: PacingRange, random: () => number = Math.random): number {
  return Math.round(range.minMs + random() * (range.maxMs - range.minMs))
}
