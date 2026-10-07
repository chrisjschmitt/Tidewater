import { execFile } from 'node:child_process'
import { basename } from 'node:path'

import type { CombineResult } from './combine.js'

import type { AccountResult } from './types.js'

/**
 * The end-of-run table. Plain aligned text on purpose: this is read once, in a
 * terminal, by someone deciding whether they need to go fix one account by
 * hand — so the useful thing is that the statuses line up and the failure
 * reasons are readable, not that it is pretty.
 */

const HEADERS = ['ACCOUNT', 'LAST 4', 'STATUS', 'FILE / NOTE'] as const

export function formatReport(results: readonly AccountResult[]): string {
  const rows = results.map((result) => [
    result.label,
    result.lastFour,
    result.status.toUpperCase(),
    note(result),
  ])

  const widths = HEADERS.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )

  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ')
      .trimEnd()

  const divider = widths.map((width) => '-'.repeat(width)).join('  ')

  return [line(HEADERS), divider, ...rows.map(line)].join('\n')
}

export function formatSummary(results: readonly AccountResult[]): string {
  const count = (status: AccountResult['status']) => results.filter((result) => result.status === status).length
  const halted = count('halted')
  const parts = [`${count('ok')} ok`, `${count('failed')} failed`, `${count('skipped')} skipped`]
  // Only mentioned when it happened — a normal run should not have to read past
  // a zero to see that nothing was interrupted.
  if (halted > 0) parts.push(`${halted} halted`)
  return parts.join(' / ')
}

function note(result: AccountResult): string {
  if (result.file) return basename(result.file)
  return result.error ?? ''
}

/** The last thing the run prints: whether there is a file to import, and what it holds. */
export function formatCombined(combined: CombineResult | undefined, accountCount: number): string {
  if (!combined?.file) return 'No combined file: no account was downloaded today.'
  const head = `Combined file ready: ${basename(combined.file)} (${combined.rows} rows, ${combined.included.length} of ${accountCount} accounts) — import it in Tidewater`
  if (combined.missing.length === 0) return head
  return `${head}\n  missing: ${combined.missing.map((account) => `${account.label} (…${account.lastFour})`).join(', ')}`
}

/**
 * A macOS notification, so the end of the run is seen even when Terminal is
 * behind Tidewater. Best effort: anywhere but a Mac, or if notifications are
 * off, it quietly does nothing.
 */
export function notifyMac(title: string, message: string): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve()
  const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
  const script = `display notification ${quote(message)} with title ${quote(title)}`
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], () => resolve())
  })
}
