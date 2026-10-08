import { useMemo } from 'react'
import type { EtmData } from './useEtmData'
import { matchFeeds, type FeedComparison } from '../../lib/etm/rules/compare'

const shiftDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10)

/** TD rows beside the Monarch rows for the same purchases, over the span the TD feed covers. */
export function useFeedComparison(data: EtmData): FeedComparison | null {
  return useMemo(() => {
    const td = data.allRows.filter((row) => row.source === 'td' && !row.duplicateOf)
    if (td.length === 0) return null
    const dates = td.map((row) => row.date).sort()
    const from = shiftDays(dates[0]!, -3)
    const to = shiftDays(dates[dates.length - 1]!, 3)
    const tdAccounts = new Set(td.map((row) => row.accountId))
    const monarch = data.allRows.filter(
      (row) => row.source === 'monarch' && row.date >= from && row.date <= to && tdAccounts.has(row.accountId),
    )
    return matchFeeds(td, monarch, {
      accounts: data.accounts,
      model: data.rules.model,
      settings: data.rules.settings,
      reimbursableTag: data.config.reimbursableTag,
    })
  }, [data.accounts, data.allRows, data.config.reimbursableTag, data.rules])
}
