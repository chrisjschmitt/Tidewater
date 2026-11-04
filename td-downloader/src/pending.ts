import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Page } from 'playwright'

import { pendingFilename } from './naming.js'

/**
 * A card's pending charges, read off its EasyWeb activity page.
 *
 * TD's CSV export only ever holds posted transactions, so a purchase is
 * missing from Tidewater for the day or three it spends pending. The card's
 * own page lists them ("Pending Transactions", with a total), so the run
 * reads that list while it is on the page anyway. Reading only: one DOM
 * query, no clicks, nothing typed.
 */

export interface PendingCharge {
  /** ISO date. */
  date: string
  description: string
  /** Negative for a charge, positive for a credit — the CSV's convention. */
  amount: number
}

export interface PendingReading {
  label: string
  lastFour: string
  /** When it was read (ISO, with time). */
  readAt: string
  /** EasyWeb's own total for the pending list (debits as a positive figure). */
  total: number
  charges: PendingCharge[]
}

export interface PendingFile {
  /** The day the readings belong to (local date). */
  date: string
  accounts: PendingReading[]
}

/** The summary figure appears with the account; the list may load a moment later. */
const SUMMARY = '#ccaaSummaryPendingTransaction'
const ROWS = 'tduf-table.authorized-tables table tbody tr'

/**
 * Shipped as a string, as in inspect.ts: tsx decorates serialized functions
 * with helpers that do not exist inside the page.
 */
const READ_JS = `(() => {
  const money = (text) => {
    const m = (text || '').replace(/\\s+/g, '').match(/-?\\$?-?([\\d,]+\\.\\d\\d)/)
    return m ? Number(m[1].replace(/,/g, '')) : null
  }
  const summary = document.querySelector('${SUMMARY}')
  const box = summary && (summary.closest('tduf-summary-data') || summary.parentElement)
  const total = box ? money(box.innerText.replace(/^[^$]*/, '')) : null
  const cell = (row, column) => {
    const td = row.querySelector('td.mat-column-' + column)
    return td ? td.innerText.replace(/\\s+/g, ' ').trim() : ''
  }
  const charges = []
  for (const row of document.querySelectorAll('${ROWS}')) {
    const date = cell(row, 'transactionDt')
    if (!date) continue
    const debit = money(cell(row, 'debitedAmount'))
    const credit = money(cell(row, 'creditedAmount'))
    charges.push({ date, description: cell(row, 'transactionDescToDisplay'), debit, credit })
  }
  return { total, charges }
})()`

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** "Nov 4, 2026" → "2026-11-04". */
export function isoFromEasyWeb(text: string): string | null {
  const m = text.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/)
  const month = m && MONTHS[m[1]!.toLowerCase()]
  return m && month ? `${m[3]}-${month}-${m[2]!.padStart(2, '0')}` : null
}

interface RawReading {
  total: number | null
  charges: { date: string; description: string; debit: number | null; credit: number | null }[]
}

/** Turns what the page showed into a reading; null when it can't be trusted. */
export function toReading(raw: RawReading, label: string, lastFour: string, readAt: string): PendingReading | null {
  if (raw.total === null) return null
  const charges: PendingCharge[] = []
  for (const c of raw.charges) {
    const date = isoFromEasyWeb(c.date)
    if (!date || (c.debit === null && c.credit === null)) return null
    const amount = Math.round(((c.credit ?? 0) - (c.debit ?? 0)) * 100) / 100
    charges.push({ date, description: c.description.replace(/\s+/g, ' ').trim(), amount })
  }
  // The list must add up to EasyWeb's own total, or the page was read half-loaded.
  const debits = Math.round(charges.reduce((s, c) => s + (c.amount < 0 ? -c.amount : 0), 0) * 100) / 100
  if (Math.abs(debits - raw.total) > 0.005) return null
  return { label, lastFour, readAt, total: raw.total, charges }
}

/**
 * Read the pending list on the card page that is open. Null when the page
 * shows no pending summary (not a card page, or EasyWeb changed) or the list
 * never matched its total — the caller reports it and carries on.
 */
export async function readPending(page: Page, label: string, lastFour: string): Promise<PendingReading | null> {
  const found = await page.waitForSelector(SUMMARY, { state: 'attached', timeout: 15_000 }).catch(() => null)
  if (!found) return null
  // Up to ~10 s for the list to finish loading and agree with the total.
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = (await page.evaluate(READ_JS)) as RawReading
    const reading = toReading(raw, label, lastFour, new Date().toISOString())
    if (reading) return reading
    await page.waitForTimeout(1000)
  }
  return null
}

/** Adds readings to the day's file, replacing each account's earlier reading. */
export async function savePending(outputDir: string, date: string, readings: PendingReading[]): Promise<string | null> {
  if (readings.length === 0) return null
  const path = join(outputDir, pendingFilename(date))
  let existing: PendingFile = { date, accounts: [] }
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as PendingFile
    if (parsed.date === date && Array.isArray(parsed.accounts)) existing = parsed
  } catch {
    /* none yet */
  }
  const fresh = new Set(readings.map((r) => r.lastFour))
  const next: PendingFile = { date, accounts: [...existing.accounts.filter((a) => !fresh.has(a.lastFour)), ...readings] }
  const partial = `${path}.partial`
  await writeFile(partial, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(partial, path)
  return path
}

export function describePending(reading: PendingReading): string {
  const n = reading.charges.length
  return `${n} pending ${n === 1 ? 'charge' : 'charges'}, $${reading.total.toFixed(2)}`
}
