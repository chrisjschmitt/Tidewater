import type { Currency } from './types'

/**
 * Money in its own currency, never converted. The shared `money` helper is
 * fixed to CAD, which would quietly mislabel a USD card.
 */
const formatters: Record<Currency, Intl.NumberFormat> = {
  CAD: new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }),
  USD: new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'USD' }),
}

export const amountIn = (value: number, currency: Currency) => formatters[currency].format(value)

/** Sums kept apart by currency, since a mixed selection has no single total. */
export function totalsByCurrency(
  rows: Array<{ amount: number; currency: Currency }>,
): Array<[Currency, number]> {
  const totals = new Map<Currency, number>()
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount)
  return [...totals.entries()].sort(([a], [z]) => a.localeCompare(z))
}

export const monthLabel = (month: string) => {
  const [year, m] = month.split('-')
  const date = new Date(Number(year), Number(m) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
