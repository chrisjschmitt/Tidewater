import { money } from './format'
import type { Budget } from './types'

/**
 * Compact derived numbers for Ask a question. Built in the lazy ETM chunk,
 * passed into the main bundle as finished data — never transactions,
 * merchants, accounts, or the vault.
 */

export type ChatCurrency = 'CAD' | 'USD'

export type ChatExpenseType =
  | 'predictable-monthly'
  | 'variable-monthly'
  | 'predictable-annual'
  | 'seasonal'
  | 'irregular'

export type ChatRemainReason = 'monthly' | 'in-progress-irregular' | 'expected-lump' | 'known-future'

export interface ChatMoney {
  CAD: number
  USD: number
}

export interface ChatCategoryActual {
  name: string
  plannedCad: number
  actual: ChatMoney
}

export interface ChatGroupActual {
  group: string
  plannedCad: number
  actual: ChatMoney
  categories: ChatCategoryActual[]
}

export interface ChatMonthActual {
  month: string
  actual: number
}

export interface ChatForecastCategory {
  series: 'forecast-household' | 'forecast-vacation'
  currency: ChatCurrency
  label: string
  type: ChatExpenseType
  likely: number
  typicalMonths: string[]
  lowSample: boolean
  windowTotal: number
  average12: number
  average24?: number
  monthsPresent: number
  /** Nonzero posted actuals on the Forecast strip (prior 12 full months + current). */
  monthlyActuals: ChatMonthActual[]
}

export interface ChatRemainLine {
  label: string
  remain: number
  reason: ChatRemainReason
}

export interface ChatOverlayLine {
  label: string
  share: number
  lowSample: boolean
}

export interface ChatHouseholdBlock {
  series: 'forecast-household'
  currency: ChatCurrency
  setAsideLikely: number
  setAsideHigh: number
  overlayMonthly: number
  overlayLines: ChatOverlayLine[]
  currentMonth: {
    month: string
    actualToDate: number
    remain: number
    forecastEom: number
    plan: number
    overlay: number
    remainLines: ChatRemainLine[]
  }
}

export interface ChatVacationBlock {
  series: 'forecast-vacation'
  currency: ChatCurrency
  pot: number
  monthlyContribution: number
  currentMonthPaused: boolean
  currentMonthActual: number
  currentMonthForecast: number
}

export interface ChatReimbursableMonth {
  month: string
  actual: ChatMoney
}

export interface ChatReimbursableBucket {
  label: string
  spend: ChatMoney
  monthlyActuals: ChatReimbursableMonth[]
}

export interface ChatReimbursableCategory {
  name: string
  spend: ChatMoney
}

export interface ChatReimbursableBlock {
  series: 'reimbursable-tab'
  spend: ChatMoney
  buckets: ChatReimbursableBucket[]
  categories: ChatReimbursableCategory[]
  monthlyActuals: ChatReimbursableMonth[]
}

export interface EtmChatSnapshot {
  asOf: string
  periodLabel: string
  periodMonths: number
  windowLabel: string
  lookbackFirst: string
  lookbackLast: string
  lookbackCount: number
  typicalMonthPlanCad: number
  budgetTab: {
    series: 'budget-tab-actuals'
    income: ChatMoney
    spend: ChatMoney
    reimbursableHeldOut: ChatMoney
    plannedTotalCad: number
    groups: ChatGroupActual[]
  }
  reimbursableTab: ChatReimbursableBlock
  forecast: {
    householdCad: ChatHouseholdBlock
    vacationCad: ChatVacationBlock
    householdUsd?: ChatHouseholdBlock
    vacationUsd?: ChatVacationBlock
    categories: ChatForecastCategory[]
  }
}

export const ETM_SERIES_NOTE = `When a spending/forecast snapshot is included:
- Budget-tab actuals are the period on screen (reimbursable family held out). They are not the lookback.
- Reimbursable-tab actuals are the Reimbursable section: the whole family for the period on screen, by bucket and category. Posted-by-month is the Forecast strip. This is not Budget-tab actuals.
- Forecast household uses an allow-list (some reimbursable sub-tags count as household). Vacation is its own series: savings sweep every month, spend is a draw on the cash date. Historical household-category questions use Forecast household lookback totals and posted-by-month, not only Budget-tab actuals.
- Overlay is the irregular smear, not the Forecast column.
Name which series you quote. Do not treat Budget-tab actuals, Reimbursable-tab actuals, and Forecast household as the same number.
CAD and USD stay separate; never add them.`

const usdMoney = (n: number) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(n))

const TYPE_LABEL: Record<ChatExpenseType, string> = {
  'predictable-monthly': 'predictable monthly',
  'variable-monthly': 'variable monthly',
  'predictable-annual': 'predictable annual',
  seasonal: 'seasonal',
  irregular: 'irregular',
}

const REMAIN_LABEL: Record<ChatRemainReason, string> = {
  monthly: 'leftover of typical monthly',
  'in-progress-irregular': 'in progress toward when-present',
  'expected-lump': 'usual this month, nothing posted',
  'known-future': 'pinned, still unpaid',
}

function typePhrase(type: ChatExpenseType, lowSample: boolean): string {
  if (type === 'irregular' && lowSample) return 'emerging (low sample)'
  return lowSample ? `${TYPE_LABEL[type]} (low sample)` : TYPE_LABEL[type]
}

function cadUsd(value: ChatMoney): string {
  const parts: string[] = [`${money(value.CAD)} CAD`]
  if (value.USD !== 0) parts.push(`${usdMoney(value.USD)} USD`)
  return parts.join(', ')
}

function amount(value: number, currency: ChatCurrency): string {
  return currency === 'USD' ? `${usdMoney(value)} USD` : `${money(value)} CAD`
}

/** Labelled lines for the cloud prompt and for reading a snapshot back. */
export function formatEtmChatSnapshot(snap: EtmChatSnapshot): string {
  const lookback =
    snap.lookbackCount > 0 && snap.lookbackFirst && snap.lookbackLast
      ? ` Lookback ${snap.lookbackFirst} through ${snap.lookbackLast} (${snap.lookbackCount} months). Posted-by-month is the Forecast strip (prior 12 full months + current).`
      : ''
  const lines: string[] = [
    `Window: ${snap.windowLabel}. As of ${snap.asOf}.${lookback}`,
    `Active period: ${snap.periodLabel} (${snap.periodMonths} month${snap.periodMonths === 1 ? '' : 's'}).`,
    `Typical-month plan (core Budget, CAD): ${money(snap.typicalMonthPlanCad)}.`,
    '',
    `Budget-tab actuals (reimbursable family held out) for ${snap.periodLabel}:`,
    `  Income ${cadUsd(snap.budgetTab.income)}. Spent ${cadUsd(snap.budgetTab.spend)}. Planned ${money(snap.budgetTab.plannedTotalCad)} CAD.`,
    `  Reimbursable family held out of these actuals: ${cadUsd(snap.budgetTab.reimbursableHeldOut)}. Detail is under Reimbursable-tab actuals.`,
  ]

  for (const group of snap.budgetTab.groups) {
    lines.push(
      `  ${group.group}: planned ${money(group.plannedCad)} CAD, actual ${cadUsd(group.actual)}.`,
    )
    for (const category of group.categories) {
      lines.push(
        `    ${category.name}: planned ${money(category.plannedCad)} CAD, actual ${cadUsd(category.actual)}.`,
      )
    }
  }

  lines.push('', formatReimbursable(snap))
  lines.push('', formatHousehold(snap.forecast.householdCad, snap.typicalMonthPlanCad))
  if (snap.forecast.householdUsd) {
    lines.push('', formatHousehold(snap.forecast.householdUsd, 0))
  }
  lines.push('', formatVacation(snap.forecast.vacationCad))
  if (snap.forecast.vacationUsd) {
    lines.push('', formatVacation(snap.forecast.vacationUsd))
  }

  if (snap.forecast.categories.length > 0) {
    lines.push('', 'Forecast per category (lookback totals + Forecast-strip months):')
    for (const category of snap.forecast.categories) {
      lines.push(`  ${formatForecastCategory(category)}`)
    }
  }

  return lines.join('\n')
}

function formatHousehold(block: ChatHouseholdBlock, typicalMonthPlanCad: number): string {
  const cur = block.currency
  const lines = [
    `Forecast household (${cur}) — series ${block.series}:`,
    `  Recommended set-aside (likely): ${amount(block.setAsideLikely, cur)}; high ${amount(block.setAsideHigh, cur)}.`,
  ]
  if (cur === 'CAD' && typicalMonthPlanCad > 0) {
    lines.push(`  Typical-month plan beside that set-aside: ${money(typicalMonthPlanCad)} CAD. Chat does not rewrite either.`)
  }
  lines.push(
    `  Overlay (irregular smear, not the Forecast column): ${amount(block.overlayMonthly, cur)} per month.`,
  )
  if (block.overlayLines.length > 0) {
    lines.push(
      `  Overlay lines: ${block.overlayLines
        .map((line) => `${line.label} ${amount(line.share, cur)}${line.lowSample ? ' (low sample)' : ''}`)
        .join('; ')}.`,
    )
  }
  const month = block.currentMonth
  lines.push(
    `  Current month ${month.month}: actual to date ${amount(month.actualToDate, cur)}; remain ${amount(month.remain, cur)}; forecast to month-end (calendar, not overlay) ${amount(month.forecastEom, cur)}; plan ${amount(month.plan, cur)}; overlay ${amount(month.overlay, cur)}.`,
  )
  if (month.remainLines.length > 0) {
    lines.push(
      `  Remain lines: ${month.remainLines
        .map((line) => `${line.label} ${amount(line.remain, cur)} (${REMAIN_LABEL[line.reason]})`)
        .join('; ')}.`,
    )
  }
  return lines.join('\n')
}

function formatVacation(block: ChatVacationBlock): string {
  return [
    `Forecast vacation (${block.currency}) — series ${block.series}:`,
    `  Pot ${amount(block.pot, block.currency)}; savings sweep ${amount(block.monthlyContribution, block.currency)} a month (never paused).`,
    `  Current month: actual ${amount(block.currentMonthActual, block.currency)}, forecast ${amount(block.currentMonthForecast, block.currency)}${block.currentMonthActual > 0 ? ' — posted spend is a draw on the pot, not a skipped transfer' : ''}.`,
  ].join('\n')
}

function formatReimbursable(snap: EtmChatSnapshot): string {
  const block = snap.reimbursableTab
  const lines = [
    `Reimbursable-tab actuals (the Reimbursable section — whole family, not Budget-tab actuals) for ${snap.periodLabel} — series ${block.series}:`,
    `  Out ${cadUsd(block.spend)}.`,
  ]
  if (block.monthlyActuals.length > 0) {
    lines.push(`  Posted by month (Forecast strip): ${formatPostedMoney(block.monthlyActuals)}.`)
  }
  for (const bucket of block.buckets) {
    const posted =
      bucket.monthlyActuals.length > 0 ? ` Posted by month: ${formatPostedMoney(bucket.monthlyActuals)}.` : ''
    lines.push(`  Bucket ${bucket.label}: ${cadUsd(bucket.spend)} this period.${posted}`)
  }
  if (block.categories.length > 0) {
    lines.push(
      `  Categories this period: ${block.categories.map((category) => `${category.name} ${cadUsd(category.spend)}`).join('; ')}.`,
    )
  }
  return lines.join('\n')
}

function formatPostedMoney(rows: ChatReimbursableMonth[]): string {
  return rows
    .filter((row) => row.actual.CAD !== 0 || row.actual.USD !== 0)
    .map((row) => `${row.month} ${cadUsd(row.actual)}`)
    .join('; ')
}

function lockedNote(kind: 'actual' | 'forecast' | 'compare'): string {
  if (kind === 'actual') {
    return 'I can only see your typical-month plan until expense tracking is unlocked. Those numbers are what you meant to spend, not what posted.'
  }
  if (kind === 'forecast') {
    return 'Forecast figures are available once expense tracking is unlocked. Until then I only have your typical-month plan.'
  }
  return 'Comparing plan to actuals needs expense tracking unlocked. From the typical-month plan alone:'
}

function formatForecastCategory(category: ChatForecastCategory): string {
  const typical =
    category.typicalMonths.length > 0 ? `, typical months ${category.typicalMonths.join(', ')}` : ''
  const avg24 =
    category.average24 != null
      ? `, 24-mo avg ${amount(category.average24, category.currency)}`
      : ''
  const posted =
    category.monthlyActuals.length > 0
      ? ` Posted by month: ${formatPostedMonths(category)}.`
      : ''
  return `[${category.series}, ${category.currency}] ${category.label} — ${typePhrase(category.type, category.lowSample)}, likely ${amount(category.likely, category.currency)}${typical}, window ${amount(category.windowTotal, category.currency)} over ${category.monthsPresent} month${category.monthsPresent === 1 ? '' : 's'}, 12-mo avg ${amount(category.average12, category.currency)}${avg24}.${posted}`
}

function formatPostedMonths(category: ChatForecastCategory): string {
  return category.monthlyActuals
    .map((row) => `${row.month} ${amount(row.actual, category.currency)}`)
    .join('; ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function labelMentioned(question: string, label: string): boolean {
  const n = label.toLowerCase().trim()
  if (n.length < 2) return false
  const q = question.toLowerCase()
  if (new RegExp(`\\b${escapeRegExp(n)}\\b`).test(q)) return true
  const tokens = n.split(/[^a-z0-9]+/).filter((token) => token.length >= 3)
  return tokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(q))
}

function mentionedForecastCategory(
  question: string,
  snap: EtmChatSnapshot,
): ChatForecastCategory | undefined {
  const hits = snap.forecast.categories
    .filter((category) => labelMentioned(question, category.label))
    .sort((a, z) => z.label.length - a.label.length)
  return hits[0]
}

function mentionedBudgetCategory(
  question: string,
  snap: EtmChatSnapshot,
): ChatCategoryActual | undefined {
  const hits: ChatCategoryActual[] = []
  for (const group of snap.budgetTab.groups) {
    for (const category of group.categories) {
      if (labelMentioned(question, category.name)) hits.push(category)
    }
  }
  hits.sort((a, z) => z.name.length - a.name.length)
  return hits[0]
}

function seriesName(category: ChatForecastCategory): string {
  return category.series === 'forecast-vacation' ? 'Forecast vacation' : 'Forecast household'
}

function mentionedReimbursableBucket(
  question: string,
  snap: EtmChatSnapshot,
): ChatReimbursableBucket | undefined {
  const hits = snap.reimbursableTab.buckets
    .filter((bucket) => labelMentioned(question, bucket.label))
    .sort((a, z) => z.label.length - a.label.length)
  return hits[0]
}

function mentionedReimbursableCategory(
  question: string,
  snap: EtmChatSnapshot,
): ChatReimbursableCategory | undefined {
  const hits = snap.reimbursableTab.categories
    .filter((category) => labelMentioned(question, category.name))
    .sort((a, z) => z.name.length - a.name.length)
  return hits[0]
}

function replyNamedReimbursable(snap: EtmChatSnapshot, question: string): string | null {
  const bucket = mentionedReimbursableBucket(question, snap)
  const category = mentionedReimbursableCategory(question, snap)
  if (!bucket && !category) return null
  const posted = (rows: ChatReimbursableMonth[]) =>
    rows.length > 0 ? formatPostedMoney(rows) : 'no month-level amounts on the strip'
  if (bucket && (!category || bucket.label.length >= category.name.length)) {
    return `Reimbursable-tab actuals (${snap.periodLabel}): ${bucket.label} is ${cadUsd(bucket.spend)} this period. That series is the Reimbursable section — the whole family, not Budget-tab actuals.\n\nPosted on the Forecast strip (prior 12 full months + current): ${posted(bucket.monthlyActuals)}. Forecast household only counts allow-listed sub-tags; Forecast vacation is its own series.`
  }
  return `Reimbursable-tab actuals (${snap.periodLabel}): ${category!.name} is ${cadUsd(category!.spend)} this period. That series is the Reimbursable section, not Budget-tab actuals.`
}

function replyNamedCategory(snap: EtmChatSnapshot, question: string): string | null {
  const reimbursableNamed = replyNamedReimbursable(snap, question)
  const forecastCat = mentionedForecastCategory(question, snap)
  const budgetCat = mentionedBudgetCategory(question, snap)
  if (!forecastCat && !budgetCat && !reimbursableNamed) return null

  if (!forecastCat && reimbursableNamed) return reimbursableNamed

  if (forecastCat) {
    const posted =
      forecastCat.monthlyActuals.length > 0
        ? formatPostedMonths(forecastCat)
        : 'no month-level amounts on the strip'
    const avg24 =
      forecastCat.average24 != null
        ? `; 24-month average ${amount(forecastCat.average24, forecastCat.currency)}`
        : ''
    const budgetLine = budgetCat
      ? ` Budget-tab actuals for ${snap.periodLabel} show ${cadUsd(budgetCat.actual)} — that series is only the period on screen.`
      : ` Budget-tab actuals for ${snap.periodLabel} do not include this category; that series is only the period on screen, not the lookback.`
    const reimbLine = reimbursableNamed ? `\n\n${reimbursableNamed}` : ''
    return `${seriesName(forecastCat)} (${snap.windowLabel}, as of ${snap.asOf}): ${forecastCat.label} posted ${amount(forecastCat.windowTotal, forecastCat.currency)} across ${forecastCat.monthsPresent} month${forecastCat.monthsPresent === 1 ? '' : 's'}. It is ${typePhrase(forecastCat.type, forecastCat.lowSample)}. 12-month average ${amount(forecastCat.average12, forecastCat.currency)}${avg24}.\n\nPosted on the Forecast strip (prior 12 full months + current): ${posted}.${budgetLine}${reimbLine}`
  }

  return `Budget-tab actuals for ${snap.periodLabel} show ${budgetCat!.name} at ${cadUsd(budgetCat!.actual)}. That series is only this period. Forecast household lookback does not include this category.`
}

export function replyActualSpend(budget: Budget, snap?: EtmChatSnapshot | null, question = ''): string {
  if (!snap) {
    return `${lockedNote('actual')}\n\nYour plan spends ${money(typicalPlan(budget))} a month.`
  }
  const named = question.trim() ? replyNamedCategory(snap, question) : null
  if (named) return named
  const { budgetTab, periodLabel } = snap
  if (budgetTab.spend.CAD === 0 && budgetTab.spend.USD === 0) {
    return `Expense tracking is unlocked, but ${periodLabel} has no Budget-tab spending yet. Reimbursable-family spend is held out of that series. Your typical-month plan is still ${money(snap.typicalMonthPlanCad)} CAD.`
  }
  const ranked = [...budgetTab.groups].sort(
    (a, z) => z.actual.CAD - a.actual.CAD || z.actual.USD - a.actual.USD,
  )
  const top = ranked.slice(0, 3)
  const detail = top
    .map((g) => `${g.group} at ${cadUsd(g.actual)}`)
    .join(', then ')
  const biggest = top[0]?.categories[0]
  const held = budgetTab.reimbursableHeldOut
  const heldLine =
    held.CAD !== 0 || held.USD !== 0
      ? `\n\nThe reimbursable family (${cadUsd(held)}) is held out of these Budget-tab actuals. That is a different split from Forecast household.`
      : '\n\nThese are Budget-tab actuals, not Forecast household — the reimbursable family is held out here.'
  return `In ${periodLabel}, Budget-tab actuals show ${cadUsd(budgetTab.spend)} spent against a ${money(budgetTab.plannedTotalCad)} CAD plan for that window.\n\nMost of that went to ${detail || 'the groups in your plan'}.${
    biggest ? ` Inside ${top[0]!.group}, the largest piece is ${biggest.name} at ${cadUsd(biggest.actual)}.` : ''
  }${heldLine}`
}

export function replyReimbursable(budget: Budget, snap?: EtmChatSnapshot | null, question = ''): string {
  if (!snap) {
    return `${lockedNote('actual')}\n\nYour plan spends ${money(typicalPlan(budget))} a month. Reimbursable figures need expense tracking unlocked.`
  }
  const named = question.trim() ? replyNamedReimbursable(snap, question) : null
  if (named) return named
  const block = snap.reimbursableTab
  if (block.spend.CAD === 0 && block.spend.USD === 0 && block.buckets.length === 0) {
    return `Reimbursable-tab actuals for ${snap.periodLabel} have nothing in the family this period. That series is the Reimbursable section, not Budget-tab actuals.`
  }
  const ranked = [...block.buckets].sort(
    (a, z) => z.spend.CAD - a.spend.CAD || z.spend.USD - a.spend.USD,
  )
  const top = ranked
    .filter((bucket) => bucket.spend.CAD !== 0 || bucket.spend.USD !== 0)
    .slice(0, 4)
  const detail = top.map((bucket) => `${bucket.label} at ${cadUsd(bucket.spend)}`).join(', then ')
  const posted =
    block.monthlyActuals.length > 0
      ? `\n\nPosted on the Forecast strip (prior 12 full months + current): ${formatPostedMoney(block.monthlyActuals)}.`
      : ''
  const categories = block.categories.slice(0, 4)
  const catLine =
    categories.length > 0
      ? ` Categories this period include ${categories.map((category) => `${category.name} at ${cadUsd(category.spend)}`).join(', ')}.`
      : ''
  return `Reimbursable-tab actuals for ${snap.periodLabel} — the Reimbursable section, not Budget-tab actuals — show ${cadUsd(block.spend)} out.${
    detail ? ` Largest buckets: ${detail}.` : ''
  }${catLine}${posted}\n\nThat is the whole reimbursable family. Forecast household only counts allow-listed sub-tags; Forecast vacation is its own series. Budget-tab actuals hold this family out.`
}

export function replyForecast(budget: Budget, snap?: EtmChatSnapshot | null): string {
  if (!snap) {
    return `${lockedNote('forecast')}\n\nYour typical-month plan spends ${money(typicalPlan(budget))} a month.`
  }
  const household = snap.forecast.householdCad
  const vacation = snap.forecast.vacationCad
  const overlay = household.overlayLines
    .slice(0, 4)
    .map((line) => line.label)
    .join(', ')
  const remain = household.currentMonth.remainLines
    .slice(0, 4)
    .map((line) => `${line.label} ${money(line.remain)}`)
    .join(', ')
  const usd = snap.forecast.householdUsd
  const usdLine = usd
    ? `\n\nUSD household sits alongside and is never added in: set-aside ${usdMoney(usd.setAsideLikely)} USD, overlay ${usdMoney(usd.overlayMonthly)} USD a month.`
    : ''
  return `Forecast household (${snap.windowLabel}, as of ${snap.asOf}) recommends setting aside ${money(household.setAsideLikely)} CAD a month. Your typical-month plan beside that is ${money(snap.typicalMonthPlanCad)} CAD. Those are two named series; neither is rewritten from this chat.\n\nThe overlay — the irregular smear, not the Forecast column — is ${money(household.overlayMonthly)} CAD a month${overlay ? ` (${overlay})` : ''}. Current month ${household.currentMonth.month}: ${money(household.currentMonth.actualToDate)} CAD posted, ${money(household.currentMonth.remain)} CAD remaining${remain ? ` (${remain})` : ''}, calendar forecast to month-end ${money(household.currentMonth.forecastEom)} CAD.\n\nForecast vacation is its own series: pot ${money(vacation.pot)} CAD, savings sweep ${money(vacation.monthlyContribution)} CAD a month (never paused). Vacation-tagged spend is a draw on the cash date.${usdLine}`
}

export function replyPlanVsActual(budget: Budget, snap?: EtmChatSnapshot | null): string {
  if (!snap) {
    return `${lockedNote('compare')}\n\nThe typical-month plan spends ${money(typicalPlan(budget))} of ${money(budget.income.reduce((s, l) => s + l.amount, 0))} that arrives.`
  }
  const spent = snap.budgetTab.spend.CAD
  const planned = snap.budgetTab.plannedTotalCad
  const delta = spent - planned
  const compare =
    delta === 0
      ? `Budget-tab actuals for ${snap.periodLabel} match the ${money(planned)} CAD plan for that window.`
      : delta < 0
        ? `Budget-tab actuals for ${snap.periodLabel} are ${money(Math.abs(delta))} CAD under the ${money(planned)} CAD plan — spare room in this window, not a miss.`
        : `Budget-tab actuals for ${snap.periodLabel} are ${money(delta)} CAD above the ${money(planned)} CAD plan for that window.`
  return `${compare}\n\nForecast household would set aside ${money(snap.forecast.householdCad.setAsideLikely)} CAD a month beside the typical-month plan of ${money(snap.typicalMonthPlanCad)} CAD. Overlay (${money(snap.forecast.householdCad.overlayMonthly)} CAD) is the irregular smear, not the Forecast column. Vacation is a separate series and is not folded into either of those household figures.`
}

export function exampleQuestions(etm?: EtmChatSnapshot | null): string[] {
  const plan = [
    'Where does most of my money go?',
    'How do I import transactions?',
    'How can I balance my budget without giving up much?',
    'How much am I keeping each month?',
    'When will I reach my savings goal?',
    'Can I afford a $2,000 trip this year?',
  ]
  if (!__ETM_AVAILABLE__ || !etm) return plan
  return [
    'What did I spend this period?',
    'What have I spent historically on a category?',
    'What did I spend in the Reimbursable section?',
    'How do I use the Month end tab?',
    'How do I use the Budget tab?',
    'How do I use the Forecast tab?',
    'What does Forecast say I should set aside?',
    'How does my spending compare to the plan?',
    'Where does most of my money go?',
    'How much am I keeping each month?',
    'When will I reach my savings goal?',
  ]
}

function typicalPlan(budget: Budget): number {
  return budget.expenses.reduce((sum, line) => sum + line.amount, 0)
}
