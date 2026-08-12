/**
 * The user's workflow, expressed as configuration rather than code (§4). It
 * lives encrypted alongside the transactions because the tag names people use
 * are themselves personal.
 *
 * Phase 4 adds the funding account, float, buckets and tolerance here. Only
 * what the reimbursable rule needs is defined so far.
 */
export interface EtmConfig {
  version: 1
  /** The tag that marks an advance repaid at month end. */
  reimbursableTag: string
}

export const DEFAULT_CONFIG: EtmConfig = {
  version: 1,
  reimbursableTag: 'Reimbursable',
}

/** Tolerates a partial or older record, so a missing field is never fatal. */
export const withDefaults = (stored: Partial<EtmConfig> | undefined): EtmConfig => ({
  ...DEFAULT_CONFIG,
  ...stored,
  version: 1,
  reimbursableTag: stored?.reimbursableTag?.trim() || DEFAULT_CONFIG.reimbursableTag,
})
