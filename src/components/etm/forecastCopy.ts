import type { ExpenseType, RemainReason } from '../../lib/forecast/types'

export const TYPE_LABEL: Record<ExpenseType, string> = {
  'predictable-monthly': 'Predictable monthly',
  'variable-monthly': 'Variable monthly',
  'predictable-annual': 'Predictable annual',
  seasonal: 'Seasonal',
  irregular: 'One-time / irregular',
}

export function typeLabel(type: ExpenseType, lowSample: boolean): string {
  if (type === 'irregular' && lowSample) return 'Emerging'
  return TYPE_LABEL[type]
}

export function confidenceLabel(confidence: 'high' | 'medium' | 'low'): string {
  if (confidence === 'high') return 'Well established'
  if (confidence === 'medium') return 'A working pattern'
  return 'Early days'
}

export function shortMonth(month: string): string {
  const [year, m] = month.split('-')
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1)).toLocaleDateString(undefined, {
    month: 'short',
    timeZone: 'UTC',
  })
}

export function seenCopy(occurrences: number, typicalMonthNames: string[]): string {
  if (occurrences <= 0) return 'No history in this window yet.'
  if (occurrences === 1) {
    const when = typicalMonthNames[0]
    return when ? `Seen once, in ${when} — not a pattern yet.` : 'Seen once — not a pattern yet.'
  }
  if (occurrences === 2) return 'Seen twice — still a small sample.'
  return `Seen in ${occurrences} months.`
}

export function controlWindowBadge(outside: boolean): string {
  return outside ? 'Outside ±5%' : 'Inside ±5%'
}

export function remainReasonCopy(reason: RemainReason): string {
  if (reason === 'monthly') return 'leftover of the typical monthly amount'
  if (reason === 'in-progress-irregular') return 'when it is present, minus spent so far'
  if (reason === 'expected-lump') return 'usual this month, nothing posted yet'
  return 'pinned on this month, still unpaid'
}

export function controlWindowDetail(outside: boolean, forecast: number, plan: number): string {
  if (!outside) return 'This month’s forecast sits within the control window of the plan.'
  if (forecast + 0.01 < plan) {
    return 'The forecast sits under the plan — spare room, not a shortfall. Placing a dated cost is still available if something known has not been given a month yet.'
  }
  return 'The forecast sits outside the control window. Placing a known cost on this month is the usual way to bring it in, and it can shrink the overlay.'
}

export function windowLabelName(window: 12 | 24 | 'all'): string {
  if (window === 'all') return 'all-time'
  return `${window}-month`
}

export function windowDisagreementCopy(
  first: { window: 12 | 24 | 'all'; likely: string },
  second: { window: 12 | 24 | 'all'; likely: string },
): string {
  return `The ${windowLabelName(first.window)} window recommends ${first.likely} a month; the ${windowLabelName(second.window)} window recommends ${second.likely}. The window you pick moves the recommendation.`
}

export function taggingGapsCopy(uncategorized: number, parentOnly: number): string {
  const parts: string[] = []
  if (uncategorized > 0) {
    parts.push(
      `${uncategorized} household ${uncategorized === 1 ? 'row still sits' : 'rows still sit'} in Uncategorized`,
    )
  }
  if (parentOnly > 0) {
    parts.push(
      `${parentOnly} reimbursable ${parentOnly === 1 ? 'row still has' : 'rows still have'} only the generic parent tag, so ${parentOnly === 1 ? 'it stays' : 'they stay'} out of both household and vacation until ${parentOnly === 1 ? 'it is' : 'they are'} retagged as Parent: …`,
    )
  }
  if (parts.length === 0) return ''
  const body = parts.length === 1 ? parts[0]! : `${parts[0]}, and ${parts[1]}`
  return `${body}. Month end’s tidy step is the place to sort ${uncategorized + parentOnly === 1 ? 'it' : 'those'}, rather than a second list here.`
}

export function excludedOutliersCopy(
  items: Array<{ label: string; month: string; amount: string }>,
): string {
  if (items.length === 0) return ''
  const named = items.map((item) => `${item.label} in ${item.month} (${item.amount})`)
  if (named.length === 1) return `Leaving aside ${named[0]} for this reading.`
  const last = named[named.length - 1]
  return `Leaving aside ${named.slice(0, -1).join(', ')} and ${last} for this reading.`
}

export function doubleCountCopy(category: string, month: string): string {
  return `${category} is already placed as a typical cost in ${month} — pinning it again would count twice. You can still place it if that is what you mean.`
}

export function fundedGoalCopy(monthsHit: number, monthsConsidered: number): string {
  return `This contribution looks fundable in about 9 months out of 10. In this window that was ${monthsHit} of ${monthsConsidered} months.`
}

export function unfundedGoalCopy(
  monthsHit: number,
  monthsConsidered: number,
  current: string,
  clearing: string,
): string {
  return `Household goals asked for ${current} a month. That would have been affordable in ${monthsHit} of ${monthsConsidered} months. A contribution of ${clearing} a month would have cleared about 9 months in 10.`
}

export function monthEndStoredCopy(month: string): string {
  return `${month} compared with the forecast this tab held at the time.`
}

export function monthEndReconstructedCopy(month: string): string {
  return `No stored snapshot for ${month}, so this is reconstructed from today’s engine — not the number you would have seen at the time.`
}

export function monthEndInsideCopy(): string {
  return 'Household actual sat inside ±5% of that forecast.'
}

export function monthEndOutsideCopy(): string {
  return 'Household actual sat outside ±5% of that forecast. Lines above the forecast can be pinned as a known future if they will land again.'
}
