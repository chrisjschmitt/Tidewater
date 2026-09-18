/**
 * The shapes shared across the run: what the config says, and what the
 * manifest records about what actually happened.
 */

export type AccountKind = 'bank' | 'credit'

/**
 * Only actions that read or trigger an export exist here. There is
 * deliberately no action that could submit a payment or a transfer — the
 * vocabulary itself is the guardrail, so a mistyped config cannot move money.
 */
export type StepAction = 'click' | 'selectOption' | 'fill' | 'check' | 'waitFor'

export interface ExportStep {
  action: StepAction
  selector: string
  value?: string
}

export interface AccountConfig {
  label: string
  lastFour: string
  kind: AccountKind
  /** Selector or link text that reaches this account from the EasyWeb home. */
  accountLink: string
  exportSteps: ExportStep[]
}

/** An inclusive millisecond range a delay is drawn from. */
export interface PacingRange {
  minMs: number
  maxMs: number
}

/** How slowly the run moves. See pacing.ts for the reasoning and defaults. */
export interface PacingConfig {
  actionDelayMs: PacingRange
  accountDelayMs: PacingRange
}

export interface RunConfig {
  cdpUrl: string
  /** Already expanded to an absolute path by the loader. */
  outputDir: string
  easywebHomeUrl: string
  /** Optional in the file, always resolved to the defaults by the loader. */
  pacing: PacingConfig
  accounts: AccountConfig[]
}

/**
 * `halted` is its own status rather than a flavour of `failed`: the account may
 * well have been fine and simply ran out of time when Ctrl+C arrived, and a
 * resume should retry it rather than treat it as broken.
 */
export type AccountStatus = 'ok' | 'failed' | 'skipped' | 'halted'

export interface AccountResult {
  label: string
  lastFour: string
  status: AccountStatus
  /** Absolute path of the saved CSV, when one was saved. */
  file?: string
  error?: string
  finishedAt?: string
}

export interface RunManifest {
  /** ISO timestamp the run started; also the manifest's filename. */
  startedAt: string
  /** Local date, YYYY-MM-DD — what "today" means for resume and filenames. */
  runDate: string
  finishedAt?: string
  cdpUrl: string
  outputDir: string
  /** True once the session guard or a fatal error ended the run early. */
  halted: boolean
  haltReason?: string
  accounts: AccountResult[]
}
