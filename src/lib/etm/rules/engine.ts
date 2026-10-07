import { normalizeTag } from '../tags'
import type { Account } from '../types'
import { isInternal, type RuleModel } from './model'
import { collapse, counterAccount, displayName, statementKey } from './normalize'
import type { Outcome, RuleResult, RuleSettings, SplitShapeLine } from './types'

/**
 * One TD row in, one complete outcome out — merchant, category, tags and any
 * split together — or the row goes to review with up to three suggestions.
 *
 * The layers, first answer wins:
 *  1. fixed      card payments; transfers to a card; dividend sources
 *  2. template   a split the row's merchant has had the same way lately
 *  3. user       a rule taught in review or the comparison
 *  4. learned    how history files this merchant, if it agrees enough
 *  5. own        a transfer to or from one of the user's own accounts
 *  6. keyword    a merchant-type word, but only into a category history uses
 *  7. review
 * and then the guards, which can send any answer back to review.
 */

export interface RuleInput {
  date: string
  description: string
  /** Signed: money out is negative. */
  amount: number
  account: Account
}

export interface RuleContext {
  model: RuleModel
  settings: RuleSettings
  accounts: Account[]
  reimbursableTag: string
}

/** Merchant-type words, tried only when history is silent. Categories are used only if history has them. */
const KEYWORDS: Array<[RegExp, string[]]> = [
  [/\bFEES?\b|INTEREST CHARGE|ACCT BAL REBATE/, ['Financial Fees', 'Bank Fees', 'Fees & Charges']],
  [/ATM W\/D|CASH WITHDRA|CASH ADV/, ['Cash for spending', 'Cash & ATM']],
  [
    /RESTAURANT|\bREST\b|CAFE|COFFEE|\bPUB\b|\bBAR\b|BREW|PIZZA|SUSHI|GRILL|BISTRO|DINER|TIM HORTONS|STARBUCKS|SWISS CHALET|BRUNCH|MCDONALD|SUBWAY|BAKERY|BACKEREI|BOULANGERIE|PATISSERIE|PASTICCERIA|ICE CREAM|GELATO|TAVERN|KITCHEN|EATERY|SHAWARMA|BURGER|TACO|DELI\b|UBER \* ?EATS|DOORDASH/,
    ['Restaurants & Bars', 'Restaurants', 'Dining'],
  ],
  [
    /GROCER|SUPERMARKET|MARKET|FARM BOY|LOBLAW|SOBEYS|FRESHCO|\bMETRO\b|NO FRILLS|FOOD BASICS|FROMAGERIE|BUTCHER|FRUIT/,
    ['Groceries'],
  ],
  [/PETRO|ESSO|SHELL|ULTRAMAR|PIONEER|CIRCLE K|MAC.S CONVENIENCE|IRVING|HUSKY|\bGAS\b/, ['Gas', 'Fuel']],
  [/HOTEL|\bINN\b|AIRBNB|VRBO|BOOKING\.COM|MOTEL|RESORT|LODGE|CAMPSITE|CAMPGROUND/, ['Lodging', 'Travel & Vacation']],
  [/AIR CANADA|PORTER|WESTJET|AIRLINE|AIRWAYS|TRANSAT|FLAIR/, ['Airfare', 'Travel & Vacation']],
  [/PARKING|IMPARK|PARKADE/, ['Parking & Tolls', 'Parking']],
  [/UBER|LYFT|TAXI|TRANSIT|VIA RAIL|\bRAIL\b|OMIO|TRAINLINE|COACH/, ['Transportation', 'Taxi & Ride Shares', 'Public Transit']],
  [/PHARM|DRUG MART|REXALL|^SDM\b|FARMACIA/, ['Medicine (over-the-counter)', 'Medical', 'Pharmacy']],
  [/LCBO|BEER STORE|\bSAQ\b|WINE|WHISK/, ['Alcohol', 'Alcohol & Bars']],
  [/CINEPLEX|THEATRE|THEATER|TICKET/, ['Entertainment & Recreation', 'Entertainment']],
  [/MUSEUM|GALLERY|GALERIE|CASTLE|ABBEY/, ['Entrance fees', 'Entertainment & Recreation']],
]

export function categorize(input: RuleInput, ctx: RuleContext): RuleResult {
  const key = statementKey(input.description)
  const merchant = ctx.model.merchants.get(key) ?? displayName(input.description)
  const card = input.account.kind === 'credit'
  const upper = collapse(input.description).toUpperCase()
  const learned = ctx.model.learned.get(key) ?? []
  const lastSplit = ctx.model.lastSplits.get(key)
  const splitSuggestion = lastSplit ? applyShape(lastSplit.lines, input.amount) : null
  const fromHistory = learned.map((item) => ({ merchant, ...item.outcome }))
  const suggestions = [
    ...fromHistory.slice(0, 1),
    ...(splitSuggestion ? [splitOutcome(merchant, splitSuggestion)] : []),
    ...fromHistory.slice(1),
  ].slice(0, 3)
  const decide = (layer: RuleResult['layer'], outcome: Omit<Outcome, 'merchant'>, confidence: RuleResult['confidence']) =>
    guard({ outcome: { merchant, ...outcome }, layer, confidence, reasons: [], suggestions }, input, ctx, key)

  // 1. Fixed: the movements whose meaning is in the text itself.
  if (card && input.amount > 0 && /^(PAYMENT|CREDIT CARD PAYMENT)\b/.test(upper)) {
    return decide('fixed', { category: 'Credit Card Payment', tags: [] }, 'high')
  }
  const counter = counterAccount(input.description)
  // A bank-account debit to a card, e.g. `TD VISA Q2J7U2`, `CIBC MC L7L3U3`.
  const cardPayment = !card && input.amount < 0 && /^([A-Z]+ )?(MC|VISA|MASTERCARD|AMEX)\s+[A-Z0-9]{6}$/.test(upper)
  if (counter?.number === 'C/C' || cardPayment) {
    return decide('fixed', { category: 'Credit Card Payment', tags: [] }, 'high')
  }
  if (counter && counter.direction === 'FR' && input.amount > 0) {
    const source = ctx.settings.dividendSources.find((s) => counter.number.endsWith(s.number) || s.number.endsWith(counter.number))
    if (source) {
      if (input.amount >= source.minAmount && input.amount % source.multiple === 0) {
        return decide('fixed', { category: source.category, tags: [] }, 'high')
      }
      if (input.amount % 100 === 0) {
        return review(merchant, suggestions, ['A round amount from the dividend account, below the usual dividend size'])
      }
      return decide('fixed', { category: 'Transfer', tags: [] }, 'high')
    }
  }

  // 2. Template: the same split, recently, nearly every time.
  const template = ctx.model.templates.get(key)
  if (template) {
    const split = applyShape(template.lines, input.amount)
    if (split) {
      const { merchant: _m, ...outcome } = splitOutcome(merchant, split)
      return decide('template', outcome, 'high')
    }
    return review(merchant, suggestions, ['An amount this merchant’s usual split does not fit'])
  }

  // 3. A rule the user taught.
  const taught =
    ctx.settings.userRules.find((rule) => rule.key === key && rule.accountId === input.account.id) ??
    ctx.settings.userRules.find((rule) => rule.key === key && !rule.accountId)
  if (taught) {
    const outcome = taught.outcome.split
      ? { ...taught.outcome, split: applyShape(taught.outcome.split, input.amount) ?? undefined }
      : taught.outcome
    return guard({ outcome, layer: 'user', confidence: 'high', reasons: [], suggestions }, input, ctx, key)
  }

  // 4. Learned from history.
  const total = learned.reduce((sum, item) => sum + item.weight, 0)
  const best = learned[0]
  if (best && total > 0 && best.weight / total >= ctx.settings.threshold) {
    const share = best.weight / total
    return decide('learned', best.outcome, share >= 0.9 && learned.length > 0 ? 'high' : 'medium')
  }

  // 5. Own accounts: a transfer between them moves money, it does not spend it.
  if (counter && isOwnAccount(counter.number, ctx.accounts)) {
    return decide('own', { category: 'Transfer', tags: [] }, 'high')
  }

  // 6. Keywords, never into a category history does not use.
  if (!best) {
    for (const [pattern, names] of KEYWORDS) {
      if (!pattern.test(upper)) continue
      const category = names.find((name) => ctx.model.categories.has(name))
      if (!category) continue
      const result = decide('keyword', { category, tags: [] }, 'low')
      return result.outcome ? { ...result, reasons: ['Not seen before: filed by the kind of merchant it looks like'] } : result
    }
  }

  return review(
    merchant,
    suggestions,
    best ? ['History files this merchant more than one way'] : ['Not seen before'],
  )
}

function review(merchant: string, suggestions: Outcome[], reasons: string[]): RuleResult {
  void merchant
  return { layer: 'review', confidence: 'low', reasons, suggestions }
}

/** The checks every answer passes; failing one sends the row to review with the answer as a suggestion. */
function guard(result: RuleResult, input: RuleInput, ctx: RuleContext, key: string): RuleResult {
  const outcome = result.outcome
  if (!outcome) return result
  const reasons: string[] = []
  const card = input.account.kind === 'credit'
  const lines = outcome.split ?? [{ category: outcome.category, tags: outcome.tags, amount: input.amount }]

  if (card && input.amount < 0 && lines.some((line) => isInternal(line.category))) {
    reasons.push('A card purchase cannot be a transfer')
  }
  if (input.amount < 0 && lines.some((line) => ctx.model.incomeCategories.has(line.category))) {
    reasons.push('Money out filed under an income category')
  }
  if (ctx.model.incomeCategories.has(outcome.category) && input.amount > 0) {
    const last = ctx.model.lastIncome.get(key)
    // Only for sizable deposits: interest that varies by the cent is not news.
    if (last && Math.abs(last) >= 100 && Math.abs(input.amount - last) > 0.25 * Math.abs(last)) {
      reasons.push(`A different amount from usual (last time ${last.toFixed(2)})`)
    }
  }
  for (const line of lines) {
    const owners = line.tags.map((tag) => ctx.model.ownerBuckets.get(normalizeTag(tag))).filter(Boolean)
    if (owners.some((owner) => owner !== line.category) && [...ctx.model.ownerBuckets.values()].includes(line.category)) {
      reasons.push('The category and the reimbursable tag name different owners')
    }
  }
  if (ctx.settings.alwaysReview.includes(key)) reasons.push('Set to always be checked')

  if (reasons.length === 0) return result
  return {
    layer: 'review',
    confidence: 'low',
    reasons,
    suggestions: [outcome, ...result.suggestions.filter((s) => s.category !== outcome.category)].slice(0, 3),
  }
}

/** A learned split scaled to this row: fixed amounts when they add up, else shares, rounding into the last line. */
export function applyShape(lines: SplitShapeLine[], amount: number): SplitShapeLine[] | null {
  const sign = amount < 0 ? -1 : 1
  const total = Math.abs(amount)
  const round = (n: number) => Math.round(n * 100) / 100
  if (lines.every((line) => typeof line.amount === 'number')) {
    const sum = round(lines.reduce((s, line) => s + (line.amount ?? 0), 0))
    if (Math.abs(sum - total) > 0.01) return null
    return lines.map((line) => ({ category: line.category, tags: line.tags, amount: round(sign * (line.amount ?? 0)) }))
  }
  let placed = 0
  return lines.map((line, index) => {
    const part = index === lines.length - 1 ? round(total - placed) : round(total * Math.abs(line.share ?? 0))
    placed = round(placed + part)
    return { category: line.category, tags: line.tags, amount: round(sign * part) }
  })
}

/** TD prints the full number; the registry keeps the last four. */
function isOwnAccount(number: string, accounts: Account[]): boolean {
  if (number === 'C/C') return true
  return accounts.some((account) => {
    const digits = account.lastFour?.trim()
    return Boolean(digits && number.endsWith(digits))
  })
}

/** A split as an outcome: the largest line names the row, the lines carry the detail. */
function splitOutcome(merchant: string, split: SplitShapeLine[]): Outcome {
  const main = [...split].sort((a, z) => Math.abs(z.amount ?? 0) - Math.abs(a.amount ?? 0))[0]!
  return { merchant, category: main.category, tags: main.tags, split }
}
