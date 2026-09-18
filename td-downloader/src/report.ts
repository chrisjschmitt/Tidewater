import { basename } from 'node:path'

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
