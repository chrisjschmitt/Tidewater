/**
 * Ctrl+C handling, kept separate because its rules are subtle.
 *
 * The first Ctrl+C is a request, not a kill: the account being worked on gets a
 * bounded moment to finish so a nearly-complete download is not thrown away,
 * and the run then stops before the next account. The second Ctrl+C is taken
 * literally and exits at once, for the case where something is genuinely stuck.
 *
 * Nothing here touches Chrome. Whatever the user's browser was doing, it keeps
 * doing — see the disconnect note in engine.ts.
 */

export class HaltRequest {
  requested = false
  private trigger: (() => void) | null = null

  /** Resolves the moment a halt is first requested. */
  readonly signal: Promise<void>

  constructor() {
    this.signal = new Promise<void>((resolve) => {
      this.trigger = resolve
    })
  }

  request(): void {
    if (this.requested) return
    this.requested = true
    this.trigger?.()
  }

  /**
   * Resolves `graceMs` after a halt is requested, and never otherwise. Raced
   * against the in-flight account so a hung page cannot hold the run open.
   */
  async grace(graceMs: number): Promise<void> {
    await this.signal
    await new Promise<void>((resolve) => {
      // Unref'd so a grace timer left over from a finished account cannot keep
      // the process alive after the report has printed.
      const timer = setTimeout(resolve, graceMs)
      timer.unref()
    })
  }
}

/**
 * Wires SIGINT to the halt request and returns a teardown so the handler does
 * not outlive the run.
 */
export function installSigintHandler(halt: HaltRequest, log: (message: string) => void): () => void {
  const onSigint = () => {
    if (halt.requested) {
      log('\nSecond Ctrl+C — exiting now. Chrome is untouched.')
      process.exit(130)
    }
    halt.request()
    log('\nCtrl+C — finishing the account in flight, then stopping. Ctrl+C again to exit immediately.')
  }

  process.on('SIGINT', onSigint)
  return () => process.off('SIGINT', onSigint)
}
