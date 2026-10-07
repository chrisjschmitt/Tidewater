import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { RAW_DIR_NAME, combinedFilename, outputFilename, partialFilename } from './naming.js'
import type { AccountConfig } from './types.js'

/**
 * Folds the day's per-account exports into the one file Tidewater imports:
 *
 *     Account,Last four,Date,Description,Debit,Credit,Balance
 *
 * One block per account, in accounts.json order. Dates are ISO whatever the
 * export used (bank files write ISO, card files MM/DD/YYYY); everything else
 * is copied as TD wrote it, so the description still matches what Monarch
 * calls the "Original Statement".
 *
 * The per-account files then move to `raw/`. They stay on disk for checking,
 * but out of the way, so the folder holds one thing to import. A resumed run
 * later the same day finds the earlier files there and folds them back in.
 */

export const COMBINED_HEADER = ['Account', 'Last four', 'Date', 'Description', 'Debit', 'Credit', 'Balance'] as const

export interface TdRow {
  date: string
  description: string
  debit: string
  credit: string
  balance: string
}

export interface CombineResult {
  /** Absolute path of the combined file; absent when there was nothing to combine. */
  file?: string
  rows: number
  included: Array<{ label: string; lastFour: string; rows: number }>
  missing: Array<{ label: string; lastFour: string }>
}

export async function combineDay(
  accounts: readonly AccountConfig[],
  outputDir: string,
  dateStamp: string,
): Promise<CombineResult> {
  const rawDir = join(outputDir, RAW_DIR_NAME)
  const lines = [COMBINED_HEADER.join(',')]
  const included: CombineResult['included'] = []
  const missing: CombineResult['missing'] = []
  const toMove: string[] = []

  for (const account of accounts) {
    const name = outputFilename(account.label, account.lastFour, dateStamp)
    const fresh = join(outputDir, name)
    const archived = join(rawDir, name)
    const source = (await exists(fresh)) ? fresh : (await exists(archived)) ? archived : null
    if (!source) {
      missing.push({ label: account.label, lastFour: account.lastFour })
      continue
    }
    const rows = parseTdExport(await readFile(source, 'utf8'))
    for (const row of rows) {
      lines.push(
        [account.label, account.lastFour, row.date, row.description, row.debit, row.credit, row.balance]
          .map(csvCell)
          .join(','),
      )
    }
    included.push({ label: account.label, lastFour: account.lastFour, rows: rows.length })
    if (source === fresh) toMove.push(name)
  }

  if (included.length === 0) return { rows: 0, included, missing }

  // Same temp-then-rename discipline as the exports: anything watching the
  // folder only ever sees a finished file under the real name.
  const finalName = combinedFilename(dateStamp)
  const finalPath = join(outputDir, finalName)
  const partialPath = join(outputDir, partialFilename(finalName))
  await writeFile(partialPath, `${lines.join('\n')}\n`, 'utf8')
  await rename(partialPath, finalPath)

  // Moved only after the combined file exists, so an interruption never
  // leaves an account in neither place.
  await mkdir(rawDir, { recursive: true })
  for (const name of toMove) {
    const target = join(rawDir, name)
    await rm(target, { force: true })
    await rename(join(outputDir, name), target)
  }

  return { file: finalPath, rows: lines.length - 1, included, missing }
}

/** Data rows in a saved export, for the per-account progress line. */
export async function countExportRows(path: string): Promise<number> {
  return parseTdExport(await readFile(path, 'utf8')).length
}

/**
 * TD exports are headerless: date, description, debit, credit, balance. Bank
 * files quote every field; card files quote none and end each line with an
 * empty sixth column. A heading row, if TD ever adds one, is skipped because
 * its first cell is not a date.
 */
export function parseTdExport(text: string): TdRow[] {
  const rows: TdRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = splitCsvLine(line)
    const date = isoDate(cells[0] ?? '')
    if (!date) continue
    rows.push({
      date,
      description: (cells[1] ?? '').trim(),
      debit: (cells[2] ?? '').trim(),
      credit: (cells[3] ?? '').trim(),
      balance: (cells[4] ?? '').trim(),
    })
  }
  return rows
}

/** ISO stays ISO; MM/DD/YYYY becomes ISO. Anything else is not a date row. */
export function isoDate(raw: string): string | null {
  const value = raw.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) return value
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (!us) return null
  const [, month, day, year] = us
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}
