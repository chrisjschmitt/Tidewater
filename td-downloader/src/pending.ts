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
  /**
   * EasyWeb's current balance as the page showed it: owed as a positive
   * figure, a credit balance negative. It counts a payment the moment TD
   * applies it, a day or two before the payment reaches the CSV export.
   */
  currentBalance?: number
  /** The card's last payment as the page showed it (ISO date). */
  lastPayment?: { date: string; amount: number }
}

export interface PendingFile {
  /** The day the readings belong to (local date). */
  date: string
  accounts: PendingReading[]
}

/** The summary figure appears with the account; the list may load a moment later. */
const SUMMARY = '#ccaaSummaryPendingTransaction'
const ROWS = 'tduf-table.authorized-tables table tbody tr'
const BALANCE = '#ccaaSummaryCurrentBalance'
const LAST_PAYMENT = '#ccaaSummaryPayLastPayment'

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
  // The card's current balance, which counts a payment before the export does:
  // owed as a positive figure, a credit balance as negative.
  const signed = (text) => {
    const m = (text || '').replace(/\\s+/g, '').match(/(-?)\\$?(-?)([\\d,]+\\.\\d\\d)(CR)?/i)
    if (!m) return null
    const value = Number(m[3].replace(/,/g, ''))
    return m[1] || m[2] || m[4] ? -value : value
  }
  const balanceLabel = document.querySelector('${BALANCE}')
  const balanceBox = balanceLabel && (balanceLabel.closest('tduf-summary-data') || balanceLabel.parentElement)
  const currentBalance = balanceBox ? signed(balanceBox.innerText.replace(/current balance/i, '')) : null
  const paid = document.querySelector('${LAST_PAYMENT}')
  const paidText = paid ? (paid.closest('tduf-summary-data') || paid).innerText.replace(/\\s+/g, ' ').trim() : ''
  const paidDate = paidText.match(/([A-Za-z]{3})[a-z]*\\.?\\s+(\\d{1,2}),\\s*(\\d{4})/)
  const lastPayment = paidDate ? { date: paidDate[0], amount: money(paidText.slice(paidText.indexOf(paidDate[0]) + paidDate[0].length)) } : null
  const charges = []
  for (const row of document.querySelectorAll('${ROWS}')) {
    const date = cell(row, 'transactionDt')
    if (!date) continue
    const debitText = cell(row, 'debitedAmount')
    const creditText = cell(row, 'creditedAmount')
    charges.push({ date, description: cell(row, 'transactionDescToDisplay'), debit: money(debitText), credit: money(creditText), debitText, creditText })
  }
  return {
    total,
    totalText: box ? box.innerText.replace(/\\s+/g, ' ').trim() : null,
    rowCount: document.querySelectorAll('${ROWS}').length,
    currentBalance,
    lastPayment,
    charges,
  }
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

export interface RawReading {
  total: number | null
  totalText?: string | null
  rowCount?: number
  currentBalance?: number | null
  lastPayment?: { date: string; amount: number | null } | null
  charges: {
    date: string
    description: string
    debit: number | null
    credit: number | null
    debitText?: string
    creditText?: string
  }[]
}

export type ReadResult =
  | { reading: PendingReading; why?: undefined; raw?: undefined }
  | { reading: null; why: string; raw?: RawReading }

const cents = (n: number) => Math.round(n * 100) / 100

/** Turns what the page showed into a reading, or says why it can't be trusted. */
export function toReading(raw: RawReading, label: string, lastFour: string, readAt: string): ReadResult {
  if (raw.total === null) return { reading: null, why: 'no pending total on the page', raw }
  const charges: PendingCharge[] = []
  for (const [i, c] of raw.charges.entries()) {
    const date = isoFromEasyWeb(c.date)
    if (!date) return { reading: null, why: `row ${i + 1}: date "${c.date}" not recognised`, raw }
    if (c.debit === null && c.credit === null) return { reading: null, why: `row ${i + 1}: no amount`, raw }
    const amount = cents((c.credit ?? 0) - (c.debit ?? 0))
    charges.push({ date, description: c.description.replace(/\s+/g, ' ').trim(), amount })
  }
  // The list must add up to EasyWeb's own total, or the page was read half-loaded.
  // The total is either the charges alone or the charges less pending credits.
  const debits = cents(charges.reduce((s, c) => s + (c.amount < 0 ? -c.amount : 0), 0))
  const net = cents(-charges.reduce((s, c) => s + c.amount, 0))
  if (Math.abs(debits - raw.total) > 0.005 && Math.abs(net - raw.total) > 0.005) {
    return {
      reading: null,
      why: `${charges.length} rows add up to $${debits.toFixed(2)}, the page's total is $${raw.total.toFixed(2)}`,
      raw,
    }
  }
  const reading: PendingReading = { label, lastFour, readAt, total: raw.total, charges }
  // Extras: kept when they read cleanly, never a reason to reject the reading.
  if (typeof raw.currentBalance === 'number') reading.currentBalance = raw.currentBalance
  const paidOn = raw.lastPayment ? isoFromEasyWeb(raw.lastPayment.date) : null
  if (paidOn && typeof raw.lastPayment?.amount === 'number') reading.lastPayment = { date: paidOn, amount: raw.lastPayment.amount }
  return { reading }
}

/**
 * Read the pending list on the card page that is open. Null when the page
 * shows no pending summary (not a card page, or EasyWeb changed) or the list
 * never matched its total — the caller reports it and carries on.
 */
export async function readPending(page: Page, label: string, lastFour: string): Promise<ReadResult> {
  const found = await page.waitForSelector(SUMMARY, { state: 'attached', timeout: 15_000 }).catch(() => null)
  if (!found) return { reading: null, why: 'no pending summary on the page' }
  // Up to ~10 s for the list to finish loading and agree with the total.
  let last: ReadResult = { reading: null, why: 'not read' }
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = (await page.evaluate(READ_JS)) as RawReading
    last = toReading(raw, label, lastFour, new Date().toISOString())
    if (last.reading) return last
    await page.waitForTimeout(1000)
  }
  return last
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
  const balance = reading.currentBalance === undefined ? ', current balance not read' : ', current balance read'
  return `${n} pending ${n === 1 ? 'charge' : 'charges'}, $${reading.total.toFixed(2)}${balance}`
}
