import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { localDateStamp } from './naming.js'
import type { AccountResult, RunManifest } from './types.js'

/**
 * The run's record on disk: `runs/run-<ISO timestamp>.json`.
 *
 * It is written only at between-account checkpoints, never mid-account. A
 * manifest that claimed an account was mid-download would be worse than no
 * manifest at all, because the resume logic reads it as truth — so the file
 * only ever describes accounts that have finished one way or another.
 *
 * `runs/` is gitignored: these files name real accounts and their last four
 * digits.
 */

export const RUNS_DIR_NAME = 'runs'

export class RunLog {
  private constructor(
    private readonly path: string,
    private readonly manifest: RunManifest,
  ) {}

  static async start(runsDir: string, options: { cdpUrl: string; outputDir: string }): Promise<RunLog> {
    await mkdir(runsDir, { recursive: true })
    const startedAt = new Date()
    // Colons are legal on macOS but a nuisance in shells and unusable on other
    // filesystems, so the ISO stamp is filename-safe.
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
    const manifest: RunManifest = {
      startedAt: startedAt.toISOString(),
      runDate: localDateStamp(startedAt),
      cdpUrl: options.cdpUrl,
      outputDir: options.outputDir,
      halted: false,
      accounts: [],
    }
    return new RunLog(join(runsDir, `run-${stamp}.json`), manifest)
  }

  get file(): string {
    return this.path
  }

  get results(): readonly AccountResult[] {
    return this.manifest.accounts
  }

  /** Records one finished account and checkpoints. Call between accounts only. */
  async record(result: AccountResult): Promise<void> {
    this.manifest.accounts.push(result)
    await this.flush()
  }

  async halt(reason: string): Promise<void> {
    this.manifest.halted = true
    this.manifest.haltReason = reason
    await this.flush()
  }

  async finish(): Promise<void> {
    this.manifest.finishedAt = new Date().toISOString()
    await this.flush()
  }

  private async flush(): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf8')
  }
}

/**
 * The set of `label/lastFour` keys that already succeeded today, gathered
 * across every manifest from today rather than just the newest one — three
 * interrupted runs in one evening should still add up to nine accounts.
 */
export async function alreadyOkToday(runsDir: string, today: string = localDateStamp()): Promise<Set<string>> {
  const done = new Set<string>()

  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch {
    return done
  }

  for (const entry of entries) {
    if (!entry.startsWith('run-') || !entry.endsWith('.json')) continue

    const manifest = await readManifest(join(runsDir, entry))
    if (!manifest || manifest.runDate !== today) continue

    for (const account of manifest.accounts) {
      if (account.status === 'ok') done.add(resumeKey(account.label, account.lastFour))
    }
  }

  return done
}

export function resumeKey(label: string, lastFour: string): string {
  return `${label}/${lastFour}`
}

async function readManifest(path: string): Promise<RunManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const manifest = parsed as Partial<RunManifest>
    // A half-written manifest from a hard kill should be ignored, not crash the
    // next run before it starts.
    if (typeof manifest.runDate !== 'string' || !Array.isArray(manifest.accounts)) return null
    return manifest as RunManifest
  } catch {
    return null
  }
}
