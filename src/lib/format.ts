const currency = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
})

const currencyPrecise = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 2,
})

export const money = (n: number) => currency.format(Math.round(n))
export const moneyPrecise = (n: number) => currencyPrecise.format(n)

export const percent = (n: number, digits = 0) =>
  `${(n * 100).toFixed(digits)}%`

export function monthsToText(months: number): string {
  if (!Number.isFinite(months) || months <= 0) return 'right away'
  const y = Math.floor(months / 12)
  const m = Math.round(months % 12)
  if (y === 0) return `${m} month${m === 1 ? '' : 's'}`
  if (m === 0) return `${y} year${y === 1 ? '' : 's'}`
  return `${y} year${y === 1 ? '' : 's'}, ${m} month${m === 1 ? '' : 's'}`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}
