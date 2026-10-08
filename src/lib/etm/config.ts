import type { GroupId } from '../types'
import type { RuleSettings } from './rules/types'
import { asFingerprint, type ExportFingerprint } from './watchFolder'

/**
 * The user's workflow, expressed as configuration rather than code (§4). It
 * lives encrypted alongside the transactions because the tag names people use
 * and the people they settle up with are themselves personal.
 */

/**
 * What a reimbursement bucket is called and who owes it. Buckets are still
 * derived from the tags on the transactions, so this only ever annotates one
 * that has already appeared — nothing can go uncounted for want of an entry
 * here, and the pivot works before any of it is filled in.
 */
export interface BucketSetting {
  /** The derived bucket label this describes, matched case-insensitively. */
  bucket: string
  /** Who is asked for the money. Free text: they need no account here. */
  owedBy: string
  /** Shown instead of the raw tag list, when the tags read awkwardly. */
  displayName?: string
}

/** Something that happens once a year, tracked so a year can be closed. */
export interface AnnualEvent {
  id: string
  label: string
  /** `MM`, the month it belongs to. */
  month: string
}

export interface EtmConfig {
  version: 1
  /** Family prefix: this tag, or any tag that starts with it plus a colon. */
  reimbursableTag: string
  /** How far the balances and the rows may disagree and still close a month. */
  tolerance: number
  buckets: BucketSetting[]
  annualEvents: AnnualEvent[]
  /**
   * The last Monarch file brought in (watched folder or Choose a CSV). Used
   * only to notice a newer export.
   */
  lastExport?: ExportFingerprint
  /**
   * Folder name from the last time the user picked an export folder. The
   * browser does not give a disk path, and a directory handle is not stored.
   */
  watchFolderName?: string
  /**
   * When the TD feed takes over from Monarch. Before the date, Monarch rows
   * count and TD rows are a shadow; from it, the reverse. Per account, with
   * a global default. Unset everywhere until the parallel run is done.
   */
  tdCutover?: TdCutover
  /**
   * Category → expense group, for names the keyword mapping in categories.ts
   * places badly (“Travel phone & data” reads as a phone bill). Kept here,
   * encrypted, so personal category names never enter the shared code.
   */
  categoryGroups?: Record<string, GroupId>
  /** The rules engine's settings (rules/types.ts): merges, retired tags, taught rules. */
  rules?: Partial<RuleSettings>
  /**
   * Month → the last day counted in it, when the month was closed early
   * (September closed on the 29th). Anything dated after it counts from the
   * first of the next month.
   */
  monthCutoffs?: Record<string, string>
}

export interface TdCutover {
  global?: string
  perAccount: Record<string, string>
}

export const DEFAULT_CONFIG: EtmConfig = {
  version: 1,
  reimbursableTag: 'Reimbursable',
  // A few dollars: enough to absorb a rounding or a stale pending charge,
  // small enough that a genuinely missing transaction still shows.
  tolerance: 5,
  buckets: [],
  annualEvents: [],
}

/** Tolerates a partial or older record, so a missing field is never fatal. */
export const withDefaults = (stored: Partial<EtmConfig> | undefined): EtmConfig => ({
  ...DEFAULT_CONFIG,
  ...stored,
  version: 1,
  reimbursableTag: stored?.reimbursableTag?.trim() || DEFAULT_CONFIG.reimbursableTag,
  tolerance:
    typeof stored?.tolerance === 'number' && stored.tolerance >= 0
      ? stored.tolerance
      : DEFAULT_CONFIG.tolerance,
  buckets: stored?.buckets ?? [],
  annualEvents: stored?.annualEvents ?? [],
  lastExport: asFingerprint(stored?.lastExport),
  watchFolderName: stored?.watchFolderName?.trim() || undefined,
  tdCutover: asCutover(stored?.tdCutover),
  categoryGroups: stored?.categoryGroups && typeof stored.categoryGroups === 'object' ? stored.categoryGroups : undefined,
  rules: stored?.rules && typeof stored.rules === 'object' ? stored.rules : undefined,
  monthCutoffs: stored?.monthCutoffs && typeof stored.monthCutoffs === 'object' ? stored.monthCutoffs : undefined,
})

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function asCutover(value: unknown): TdCutover | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<TdCutover>
  const perAccount: Record<string, string> = {}
  for (const [id, date] of Object.entries(raw.perAccount ?? {})) {
    if (typeof date === 'string' && ISO_DAY.test(date)) perAccount[id] = date
  }
  const global = typeof raw.global === 'string' && ISO_DAY.test(raw.global) ? raw.global : undefined
  if (!global && Object.keys(perAccount).length === 0) return undefined
  return { ...(global ? { global } : {}), perAccount }
}

const key = (label: string) => label.trim().toLowerCase()

export const settingFor = (
  config: EtmConfig,
  bucket: string,
): BucketSetting | undefined => config.buckets.find((b) => key(b.bucket) === key(bucket))

/** The bucket's own words if it has been given any, else the tags themselves. */
export const bucketName = (config: EtmConfig, bucket: string): string =>
  settingFor(config, bucket)?.displayName?.trim() || bucket

export const owedBy = (config: EtmConfig, bucket: string): string =>
  settingFor(config, bucket)?.owedBy?.trim() ?? ''

/** Replaces the entry for a bucket, or adds one, keeping the rest in order. */
export function withBucketSetting(config: EtmConfig, setting: BucketSetting): EtmConfig {
  const others = config.buckets.filter((b) => key(b.bucket) !== key(setting.bucket))
  const emptied = !setting.owedBy.trim() && !setting.displayName?.trim()
  return {
    ...config,
    buckets: emptied
      ? others
      : [...others, setting].sort((a, z) => a.bucket.localeCompare(z.bucket)),
  }
}
