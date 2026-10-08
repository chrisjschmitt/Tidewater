/**
 * The shapes of the rules engine. Everything here is either learned afresh
 * from the transactions already in the vault, or a setting the user chose —
 * nothing about a particular household is written into the code.
 */

/** What a rule decides for one row, all at once: who, which category, which tags, and any split. */
export interface Outcome {
  merchant: string
  category: string
  tags: string[]
  split?: SplitShapeLine[]
  /** A comment the rule writes on the row (taught rules only). */
  notes?: string
}

/** One line of a learned split. A fixed amount when the split always used the same figures, else a share. */
export interface SplitShapeLine {
  category: string
  tags: string[]
  amount?: number
  share?: number
  notes?: string
}

export type RuleLayer = 'fixed' | 'template' | 'user' | 'learned' | 'own' | 'keyword' | 'review'

export interface RuleResult {
  /** Absent when the row goes to review with nothing settled. */
  outcome?: Outcome
  layer: RuleLayer
  confidence: 'high' | 'medium' | 'low'
  /** Why a row needs a look, in plain words. Empty when the outcome stands. */
  reasons: string[]
  /** Up to three complete outcomes to offer in review, best first. */
  suggestions: Outcome[]
}

/** A rule taught by the user from a review or a comparison. Wins over anything learned. */
export interface UserRule {
  id: string
  key: string
  /** Only for this account, when set. */
  accountId?: string
  /** Only for this exact amount, when set (signed, like the row). */
  amount?: number
  outcome: Outcome
  createdAt: string
}

/** An account whose incoming transfers are dividends when large and round, ordinary repayments otherwise. */
export interface DividendSource {
  number: string
  minAmount: number
  multiple: number
  category: string
}

/** The user's own choices, kept encrypted in EtmConfig.rules. */
export interface RuleSettings {
  /** Category → the category it now belongs to, applied to history before learning. */
  categoryMerges: Record<string, string>
  /** Tags no longer used: never produced, ignored in history. */
  retiredTags: string[]
  dividendSources: DividendSource[]
  userRules: UserRule[]
  /** Statement keys whose rows are always offered for review rather than settled. */
  alwaysReview: string[]
  /** How much agreement history needs before a learned rule settles a row on its own. */
  threshold: number
  /** Half-life of history, in months: recent conventions outweigh old ones. */
  halfLifeMonths: number
  /** TD row ids whose disagreement with Monarch was looked at and left as it is. */
  dismissed: string[]
  /** Family trips: spending in the range, on the family accounts, gets the trip tag. */
  trips: Trip[]
  familyAccountIds: string[]
  /** The tag a trip adds, e.g. the vacation fund's reimbursable tag. Empty: trips add none. */
  tripTag: string
  /** Categories that never get the trip tag automatically (meals and groceries are part of everyday life). */
  tripSkipCategories: string[]
  /** On a trip, these categories become another (fuel for a rental car → travel, a phone bill → travel data). */
  tripRecategorize: Record<string, string>
  /** Pairs of TD row ids (sorted, joined by '|') the user said are not duplicates. */
  notDuplicates: string[]
}

export interface Trip {
  id: string
  label: string
  /** First and last day, inclusive, YYYY-MM-DD. */
  start: string
  end: string
}

export const DEFAULT_RULE_SETTINGS: RuleSettings = {
  categoryMerges: {},
  retiredTags: [],
  dividendSources: [],
  userRules: [],
  alwaysReview: [],
  threshold: 0.6,
  halfLifeMonths: 6,
  dismissed: [],
  trips: [],
  familyAccountIds: [],
  tripTag: '',
  tripSkipCategories: ['Restaurants & Bars', 'Groceries'],
  tripRecategorize: {},
  notDuplicates: [],
}

export function withRuleDefaults(stored: Partial<RuleSettings> | undefined): RuleSettings {
  return {
    categoryMerges: stored?.categoryMerges && typeof stored.categoryMerges === 'object' ? stored.categoryMerges : {},
    retiredTags: Array.isArray(stored?.retiredTags) ? stored.retiredTags : [],
    dividendSources: Array.isArray(stored?.dividendSources) ? stored.dividendSources : [],
    userRules: Array.isArray(stored?.userRules) ? stored.userRules : [],
    alwaysReview: Array.isArray(stored?.alwaysReview) ? stored.alwaysReview : [],
    threshold:
      typeof stored?.threshold === 'number' && stored.threshold > 0.5 && stored.threshold <= 1
        ? stored.threshold
        : DEFAULT_RULE_SETTINGS.threshold,
    halfLifeMonths:
      typeof stored?.halfLifeMonths === 'number' && stored.halfLifeMonths > 0
        ? stored.halfLifeMonths
        : DEFAULT_RULE_SETTINGS.halfLifeMonths,
    dismissed: Array.isArray(stored?.dismissed) ? stored.dismissed : [],
    trips: Array.isArray(stored?.trips) ? stored.trips : [],
    familyAccountIds: Array.isArray(stored?.familyAccountIds) ? stored.familyAccountIds : [],
    tripTag: typeof stored?.tripTag === 'string' ? stored.tripTag : '',
    tripSkipCategories: Array.isArray(stored?.tripSkipCategories)
      ? stored.tripSkipCategories
      : DEFAULT_RULE_SETTINGS.tripSkipCategories,
    tripRecategorize:
      stored?.tripRecategorize && typeof stored.tripRecategorize === 'object' ? stored.tripRecategorize : {},
    notDuplicates: Array.isArray(stored?.notDuplicates) ? stored.notDuplicates : [],
  }
}
