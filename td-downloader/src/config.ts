import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import { DEFAULT_ACCOUNT_DELAY, DEFAULT_ACTION_DELAY } from './pacing.js'
import type {
  AccountConfig,
  AccountKind,
  ExportStep,
  PacingConfig,
  PacingRange,
  RunConfig,
  StepAction,
} from './types.js'

/**
 * Reads and validates `accounts.json`.
 *
 * Validation is loud and specific rather than forgiving. This config is edited
 * by hand in the middle of a live banking session, and a typo that silently
 * turns into `undefined` would be discovered as a stray click on a real page —
 * so anything unexpected stops the run before Chrome is even contacted.
 */

/**
 * Every selector ships as this literal. The engine treats an account still
 * carrying it as unconfigured and never touches the page for it.
 */
export const SELECTOR_PLACEHOLDER = 'TODO-set-in-live-session'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const STEP_ACTIONS: readonly StepAction[] = ['click', 'selectOption', 'fill', 'check', 'waitFor']
const ACCOUNT_KINDS: readonly AccountKind[] = ['bank', 'credit']

export async function loadConfig(path: string): Promise<RunConfig> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new ConfigError(`Could not read the config at ${path}. Copy accounts.json from the repo if it has gone missing.`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${messageOf(error)}`)
  }

  const root = asRecord(raw, 'the config file')

  const cdpUrl = requireString(root, 'cdpUrl', 'the config file')
  assertLocalCdpUrl(cdpUrl)

  const outputDir = expandHome(requireString(root, 'outputDir', 'the config file'))
  const easywebHomeUrl = requireString(root, 'easywebHomeUrl', 'the config file')
  const pacing = parsePacing(root['pacing'])

  const list = root['accounts']
  if (!Array.isArray(list) || list.length === 0) {
    throw new ConfigError('The config needs an "accounts" array with at least one account in it.')
  }

  const accounts = list.map((entry, index) => parseAccount(entry, index))

  // Two accounts sharing a label and last-four would write to the same
  // filename, and the second would quietly overwrite the first.
  const seen = new Set<string>()
  for (const account of accounts) {
    const key = `${account.label}/${account.lastFour}`
    if (seen.has(key)) {
      throw new ConfigError(`Two accounts share the label "${account.label}" and last four ${account.lastFour}. They would overwrite each other's file.`)
    }
    seen.add(key)
  }

  return { cdpUrl, outputDir, easywebHomeUrl, pacing, accounts }
}

/**
 * `pacing` is optional; absent means the defaults from pacing.ts. Ranges are
 * written `[min, max]` because that is how a person thinks about "a few
 * seconds", and a swapped pair is rejected rather than quietly sorted — if the
 * intent was 4 to 10 seconds and the file says `[10, 4]`, one of the two
 * numbers is wrong and only the author knows which.
 */
function parsePacing(raw: unknown): PacingConfig {
  if (raw === undefined) {
    return { actionDelayMs: DEFAULT_ACTION_DELAY, accountDelayMs: DEFAULT_ACCOUNT_DELAY }
  }

  const record = asRecord(raw, '"pacing"')
  return {
    actionDelayMs: parseRange(record['actionDelayMs'], 'pacing.actionDelayMs', DEFAULT_ACTION_DELAY),
    accountDelayMs: parseRange(record['accountDelayMs'], 'pacing.accountDelayMs', DEFAULT_ACCOUNT_DELAY),
  }
}

function parseRange(raw: unknown, where: string, fallback: PacingRange): PacingRange {
  if (raw === undefined) return fallback

  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new ConfigError(`${where} must be a two-number array of milliseconds, like [1500, 4000].`)
  }

  const [minMs, maxMs] = raw as [unknown, unknown]
  if (!isFiniteNumber(minMs) || !isFiniteNumber(maxMs)) {
    throw new ConfigError(`${where} must hold two numbers of milliseconds, like [1500, 4000].`)
  }
  if (minMs < 0 || maxMs < 0) {
    throw new ConfigError(`${where} cannot be negative.`)
  }
  if (minMs > maxMs) {
    throw new ConfigError(`${where} has its minimum (${minMs}) above its maximum (${maxMs}). Write it as [min, max].`)
  }

  return { minMs, maxMs }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The debugger port is a wide-open door into a logged-in banking session, so
 * this tool only ever reaches for one on this machine.
 */
function assertLocalCdpUrl(cdpUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(cdpUrl)
  } catch {
    throw new ConfigError(`"cdpUrl" is not a URL: ${cdpUrl}`)
  }
  if (parsed.protocol !== 'http:' || (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1')) {
    throw new ConfigError(`"cdpUrl" must point at this machine, like http://localhost:9222 — got ${cdpUrl}`)
  }
}

function parseAccount(entry: unknown, index: number): AccountConfig {
  const where = `accounts[${index}]`
  const record = asRecord(entry, where)

  const label = requireString(record, 'label', where)
  const lastFour = requireString(record, 'lastFour', where)
  if (!/^\d{4}$/.test(lastFour)) {
    throw new ConfigError(`${where}.lastFour should be exactly four digits as a string (leading zeros matter) — got "${lastFour}".`)
  }

  const kind = requireString(record, 'kind', where)
  if (!ACCOUNT_KINDS.includes(kind as AccountKind)) {
    throw new ConfigError(`${where}.kind must be "bank" or "credit" — got "${kind}".`)
  }

  const accountLink = requireString(record, 'accountLink', where)

  const steps = record['exportSteps']
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ConfigError(`${where}.exportSteps must be a non-empty array of steps.`)
  }

  return {
    label,
    lastFour,
    kind: kind as AccountKind,
    accountLink,
    exportSteps: steps.map((step, stepIndex) => parseStep(step, `${where}.exportSteps[${stepIndex}]`)),
  }
}

function parseStep(entry: unknown, where: string): ExportStep {
  const record = asRecord(entry, where)

  const action = requireString(record, 'action', where)
  if (!STEP_ACTIONS.includes(action as StepAction)) {
    throw new ConfigError(`${where}.action must be one of ${STEP_ACTIONS.join(', ')} — got "${action}". Only read and export actions exist on purpose.`)
  }

  const selector = requireString(record, 'selector', where)

  const rawValue = record['value']
  if (rawValue !== undefined && typeof rawValue !== 'string') {
    throw new ConfigError(`${where}.value must be a string when present.`)
  }

  const needsValue = action === 'selectOption' || action === 'fill'
  if (needsValue && rawValue === undefined) {
    throw new ConfigError(`${where} uses "${action}", which needs a "value".`)
  }

  return rawValue === undefined
    ? { action: action as StepAction, selector }
    : { action: action as StepAction, selector, value: rawValue }
}

/**
 * True when the account still carries shipped placeholders anywhere the engine
 * would need a real selector. Checked before any page interaction.
 */
export function hasPlaceholderSelectors(account: AccountConfig): boolean {
  if (account.accountLink === SELECTOR_PLACEHOLDER) return true
  return account.exportSteps.some(
    (step) => step.selector === SELECTOR_PLACEHOLDER || step.value === SELECTOR_PLACEHOLDER,
  )
}

export const PLACEHOLDER_MESSAGE =
  'selectors not configured — fill these in during the paired live session against EasyWeb'

function expandHome(value: string): string {
  const expanded = value === '~' || value.startsWith('~/') ? resolve(homedir(), value.slice(1).replace(/^\/+/, '')) : value
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${where} should be a JSON object.`)
  }
  return value as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${where} is missing a non-empty "${key}" string.`)
  }
  return value
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
