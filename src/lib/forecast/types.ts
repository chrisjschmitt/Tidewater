import type { Currency } from '../etm/types'

export type ForecastWindow = 12 | 24 | 'all'

export type ExpenseType =
  | 'predictable-monthly'
  | 'variable-monthly'
  | 'predictable-annual'
  | 'seasonal'
  | 'irregular'

export type Confidence = 'high' | 'medium' | 'low'

export type LumpyMethod = 'average' | 'percent-buffer'

export type SeriesId = 'household' | 'vacation'

export type Assignment = SeriesId | 'excluded' | 'dropped'

export interface CategoryOverride {
  type?: ExpenseType
  /** Replaces the engine's likely amount for this category. */
  amount?: number
  /** Calendar months 1–12. */
  typicalMonths?: number[]
  ignoreOutliers?: boolean
}

export type PinAddsTo = 'plan' | 'both'

export interface KnownFuture {
  id: string
  category: string
  amount: number
  /** YYYY-MM */
  month: string
  recurrence: 'once' | 'annual'
  series: SeriesId
  /** Why this pin sits on this month. Empty is fine. */
  notes: string
  /**
   * `plan` raises this month’s Plan only (the trend is already in Forecast).
   * Omitted or `both` is a dated cost on Plan and Forecast, and can leave Risk.
   */
  addsTo?: PinAddsTo
}

/** Draft used when pinning a cost onto a month. */
export interface PinRequest {
  category: string
  amount: number
  notes?: string
  recurrence?: KnownFuture['recurrence']
  series?: SeriesId
  addsTo?: PinAddsTo
}

export interface ForecastConfig {
  version: 1
  window: ForecastWindow
  reimbursableAllowList: string[]
  vacationTags: string[]
  vacationGoalId?: string
  lumpyMethod: LumpyMethod
  bufferPercent: number
  inflationPercent: number
  excludeTopOutliers: number
  coverageTarget: number
  categoryOverrides: Record<string, CategoryOverride>
  knownFutures: KnownFuture[]
  /** Category keys dropped below the Plan vs forecast line, by YYYY-MM. */
  ignoredCompare: Record<string, string[]>
}

export interface ForecastSnapshot {
  month: string
  asOf: string
  window: ForecastWindow
  calendar: number
  overlay: number
  setAsideLikely: number
  setAsideHigh: number
  plan: number
  actual?: number
  vacationForecast?: number
  vacationActual?: number
  byCategory: Array<{ key: string; forecast: number; actual?: number }>
}

export const DEFAULT_ALLOW_LIST = [
  'Reimbursable: Healthcare Account',
  'Reimbursable: Capital Account',
  'Reimbursable: Annual Fees Account',
]

export const DEFAULT_VACATION_TAGS = ['Reimbursable: Vacation Account']

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  version: 1,
  window: 12,
  reimbursableAllowList: [...DEFAULT_ALLOW_LIST],
  vacationTags: [...DEFAULT_VACATION_TAGS],
  lumpyMethod: 'average',
  bufferPercent: 0,
  inflationPercent: 0,
  excludeTopOutliers: 0,
  coverageTarget: 0.9,
  categoryOverrides: {},
  knownFutures: [],
  ignoredCompare: {},
}

/** Tolerates a partial record so a missing field is never fatal. */
export function withForecastDefaults(stored?: Partial<ForecastConfig>): ForecastConfig {
  const lumpyMethod: LumpyMethod = stored?.lumpyMethod === 'percent-buffer' ? 'percent-buffer' : 'average'
  const outliers = stored?.excludeTopOutliers
  return {
    version: 1,
    window: stored?.window === 12 || stored?.window === 24 || stored?.window === 'all' ? stored.window : 12,
    reimbursableAllowList: Array.isArray(stored?.reimbursableAllowList)
      ? stored.reimbursableAllowList
      : [...DEFAULT_ALLOW_LIST],
    vacationTags: Array.isArray(stored?.vacationTags) ? stored.vacationTags : [...DEFAULT_VACATION_TAGS],
    vacationGoalId: stored?.vacationGoalId?.trim() || undefined,
    lumpyMethod,
    bufferPercent:
      lumpyMethod === 'percent-buffer' && typeof stored?.bufferPercent === 'number' && stored.bufferPercent > 0
        ? stored.bufferPercent
        : 0,
    inflationPercent:
      typeof stored?.inflationPercent === 'number' && stored.inflationPercent > 0 ? stored.inflationPercent : 0,
    excludeTopOutliers: outliers === 1 || outliers === 2 ? outliers : 0,
    coverageTarget:
      typeof stored?.coverageTarget === 'number' && stored.coverageTarget > 0 && stored.coverageTarget <= 1
        ? stored.coverageTarget
        : 0.9,
    categoryOverrides: stored?.categoryOverrides ?? {},
    knownFutures: stored?.knownFutures ?? [],
    ignoredCompare:
      stored?.ignoredCompare &&
      typeof stored.ignoredCompare === 'object' &&
      !Array.isArray(stored.ignoredCompare)
        ? stored.ignoredCompare
        : {},
  }
}

export interface CategoryForecast {
  key: string
  label: string
  type: ExpenseType
  /** Automatic classification before any type override. */
  suggestedType: ExpenseType
  confidence: Confidence
  overridden: boolean
  occurrences: number
  monthsPresent: number
  meanPresent: number
  cv: number
  typicalMonths: number[]
  typicalMonthNames: string[]
  likely: number
  high: number
  low: number
  windowTotal: number
  setAsideShare: number
  lastAmount: number
  usedLastAmount: boolean
  lowSample: boolean
  /**
   * True when a matching typical-month Budget line is standing in for the
   * calendar amount because history is not yet monthly.
   */
  usedPlanPrior: boolean
  repeatedCycle: boolean
  /** Mean monthly spend over the last 12 lookback months (or all, if fewer). */
  average12: number
  /** Mean monthly spend over the last 24 lookback months, when that many exist. */
  average24?: number
  drift?: string
}

export interface MonthCategoryAmount {
  key: string
  label: string
  type: ExpenseType
  forecast: number
  actual: number
  source: 'monthly' | 'annual' | 'seasonal' | 'known-future' | 'none'
}

export interface VarianceRow {
  key: string
  label: string
  forecast: number
  plan: number
  delta: number
}

/** One segment of the household timeline stack. Household is first. */
export interface TimelineStack {
  key: string
  label: string
  amount: number
}

export interface MonthPoint {
  month: string
  kind: 'past' | 'current' | 'future'
  actual: number
  calendar: number
  overlay: number
  plan: number
  knownFutures: number
  outsideControlWindow: boolean
  gapRatio: number
  byCategory: MonthCategoryAmount[]
  variances: VarianceRow[]
  /** Plan vs forecast by category, largest |difference| first. */
  planVsForecast: VarianceRow[]
  /**
   * Posted composition (past and current). Empty on future months.
   * Household sits at the bottom; each allow-listed reimbursable bucket
   * is a segment.
   */
  actualStack: TimelineStack[]
  /**
   * Forecast composition (calendar, or forecast to month-end on current).
   * Same stack order as `actualStack`.
   */
  forecastStack: TimelineStack[]
  /**
   * The bar the timeline treats as the reading: posted spend on past
   * months, forecast to month-end on current, calendar on future.
   */
  stack: TimelineStack[]
}

export interface OverlayLine {
  key: string
  label: string
  /** This line’s smear: window total / N. */
  share: number
  /** Full lookback total; a sensible default when pinning the line onto a month. */
  windowTotal: number
  lastAmount: number
  lowSample: boolean
}

export interface OverlayBreakdown {
  irregularWindowTotal: number
  placedNextYear: number
  unplaced: number
  monthly: number
  excludedOutliers: Array<{ key: string; month: string; amount: number }>
  /** Irregular / emerging lines that feed the overlay, before pins and outlier cuts. */
  lines: OverlayLine[]
}

export interface ForecastMixLine {
  key: string
  label: string
  amount: number
  source: MonthCategoryAmount['source']
  placementId?: string
  recurrence?: KnownFuture['recurrence']
  notes?: string
}

export interface ForecastMix {
  monthly: ForecastMixLine[]
  lumpy: ForecastMixLine[]
  pinned: ForecastMixLine[]
  /** Pins that raise Plan only; not in `total`. */
  onPlan: ForecastMixLine[]
  total: number
}

export interface SetAside {
  likely: number
  high: number
  low: number
  monthlyLikely: number
  lumpyShare: number
  overlay: number
  buffer: number
  windowLabel: string
}

export type RemainReason = 'monthly' | 'in-progress-irregular' | 'expected-lump' | 'known-future'

/** One leftover that makes up current-month `remain`. */
export interface RemainLine {
  key: string
  label: string
  typical: number
  actual: number
  remain: number
  reason: RemainReason
}

export interface CurrentMonthView {
  month: string
  actualToDate: number
  remain: number
  remainHigh: number
  forecastEom: number
  plan: number
  overlay: number
  outsideControlWindow: boolean
  gapRatio: number
  variances: VarianceRow[]
  /** Categories whose typical month is this one and that have already posted. */
  postedTypicalKeys: string[]
  remainLines: RemainLine[]
  /** Plan vs forecast-to-month-end by category, largest |difference| first. */
  planVsForecast: VarianceRow[]
}

export interface HouseholdForecast {
  categories: CategoryForecast[]
  calendar: MonthPoint[]
  overlay: OverlayBreakdown
  setAside: SetAside
  currentMonth: CurrentMonthView
}

export interface VacationMonth {
  month: string
  kind: 'past' | 'current' | 'future'
  actual: number
  forecast: number
  isTravel: boolean
  contribution: number
  runway: number
}

export interface VacationForecast {
  categories: CategoryForecast[]
  months: VacationMonth[]
  pot: number
  /** Expected savings sweep into the pot each month, not goal.monthly. */
  monthlyContribution: number
  /** Always false: the savings sweep is never paused for vacation spend. */
  currentMonthPaused: boolean
  runwayGoesNegative: boolean
  firstShortfallMonth?: string
}

export interface CurrencyForecast {
  currency: Currency
  household: HouseholdForecast
  vacation: VacationForecast
}

export interface CoverageResult {
  householdCommitted: number
  vacationMonthly: number
  income: number
  coverage: number
  coverageTarget: number
  funded: boolean
  monthsHit: number
  monthsConsidered: number
  /** Monthly contribution that would have cleared the coverage target. */
  contributionThatWouldClear: number
  highSetAside: number
}

export interface VacationGoalMatch {
  status: 'matched' | 'missing' | 'ambiguous'
  goalId?: string
  goalName?: string
  monthly: number
  current: number
}

export interface DoubleCountWarning {
  category: string
  month: string
}

export interface ForecastResult {
  asOf: string
  window: ForecastWindow
  lookback: string[]
  requestedMonths: number | 'all'
  availableMonths: number
  windowLabel: string
  reimbursableParentTag: string
  seriesCounts: { household: number; vacation: number; excluded: number; dropped: number }
  cad: CurrencyForecast
  usd: CurrencyForecast
  coverage: CoverageResult
  vacationGoal: VacationGoalMatch
  doubleCounts: DoubleCountWarning[]
}
