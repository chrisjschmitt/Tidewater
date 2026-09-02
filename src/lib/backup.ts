import type { Budget, ExpenseLine, Goal, IncomeLine, Profile } from './types'

const SOURCES: Budget['source'][] = ['onboarding', 'sample', 'budget-csv', 'transactions']

/**
 * The on-disk JSON backup. It is the budget object Tidewater has always
 * written, plus an optional `etm` field. Older files have no `etm` key;
 * files written without expense tracking still have none.
 *
 * `etm` is treated as opaque here so the main bundle never imports the
 * vault. The expense module validates it before writing IndexedDB.
 */
export interface TidewaterBackup extends Budget {
  etm?: unknown
}

export class BackupFormatError extends Error {
  constructor(message = 'That JSON file does not look like a Tidewater backup.') {
    super(message)
    this.name = 'BackupFormatError'
  }
}

/** Budget JSON, with the vault section only when one was actually exported. */
export function serializeTidewaterBackup(budget: Budget, etm?: unknown): string {
  if (etm !== undefined && etm !== null) {
    return JSON.stringify({ ...budget, etm }, null, 2)
  }
  return JSON.stringify(budget, null, 2)
}

/**
 * Split a backup file into the plan (safe to persist) and an optional vault
 * blob. Extra keys such as `etm` never land on the budget object.
 */
export function parseTidewaterBackup(text: string): { budget: Budget; etm?: unknown } {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new BackupFormatError()
  }
  if (!isRecord(raw) || !Array.isArray(raw.expenses) || !Array.isArray(raw.income)) {
    throw new BackupFormatError()
  }

  const budget: Budget = {
    version: 1,
    profile: asProfile(raw.profile),
    income: raw.income as IncomeLine[],
    expenses: raw.expenses as ExpenseLine[],
    goals: Array.isArray(raw.goals) ? (raw.goals as Goal[]) : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    source: isSource(raw.source) ? raw.source : 'budget-csv',
  }
  if (typeof raw.sourceNote === 'string' && raw.sourceNote.length > 0) {
    budget.sourceNote = raw.sourceNote
  }

  return 'etm' in raw ? { budget, etm: raw.etm } : { budget }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: unknown): value is Budget['source'] {
  return typeof value === 'string' && (SOURCES as string[]).includes(value)
}

function asProfile(value: unknown): Profile {
  if (!isRecord(value)) {
    throw new BackupFormatError()
  }
  return value as unknown as Profile
}
