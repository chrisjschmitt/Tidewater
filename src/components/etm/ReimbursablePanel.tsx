import { useMemo, useState } from 'react'
import TransactionTable from './TransactionTable'
import {
  aggregate,
  bucketLabel,
  bucketOf,
  isEmpty,
  isReimbursable,
  presentIn,
  NO_BUCKET,
  type Money,
} from '../../lib/etm/aggregate'
import {
  DEFAULT_CONFIG,
  bucketName,
  owedBy,
  settingFor,
  withBucketSetting,
  type EtmConfig,
} from '../../lib/etm/config'
import { amountIn } from '../../lib/etm/format'
import { includes, periodLabel, type Period } from '../../lib/etm/period'
import type { Account, Transaction } from '../../lib/etm/types'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  period: Period
  config: EtmConfig
  onConfigChange: (config: EtmConfig) => void
}

/**
 * Advances that get repaid at month end, gathered by whatever else they were
 * tagged with. These are deliberately absent from the budget (§5), so this is
 * the one place they are counted — and the input to the reimbursement pivot.
 */
export default function ReimbursablePanel({
  accounts,
  transactions,
  period,
  config,
  onConfigChange,
}: Props) {
  const [openBucket, setOpenBucket] = useState<string | null>(null)
  const tag = config.reimbursableTag

  const excluded = useMemo(
    () => new Set(accounts.filter((a) => a.excludedFromBudget).map((a) => a.id)),
    [accounts],
  )
  const actuals = useMemo(
    () => aggregate(transactions, period, { excludeAccountIds: excluded, reimbursableTag: tag }),
    [transactions, period, excluded, tag],
  )
  const { reimbursable } = actuals

  const rowsFor = (label: string) =>
    transactions
      .filter(
        (t) =>
          !t.internal &&
          !excluded.has(t.accountId) &&
          includes(period, t.date) &&
          isReimbursable(t, tag) &&
          bucketLabel(bucketOf(t, tag)) === label,
      )
      .sort((a, z) => a.date.localeCompare(z.date))

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <header className="mb-5">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Reimbursable</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            {periodLabel(period)} · money you put out that comes back. It is kept
            out of the budget comparison entirely, because the repayment arrives
            as a transfer and counting the purchase would say you spent more than
            you did.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label="Reimbursable out" money={reimbursable.spend} />
          <Figure label="Budget spending" money={actuals.spend} />
          <Figure label="Total out" money={actuals.totalOut} />
        </div>

        <p className="mt-3 text-xs text-ink-400">
          {reimbursable.count.toLocaleString()} transaction
          {reimbursable.count === 1 ? '' : 's'} in the “{tag}” family this period
          — the generic tag, or any “{tag}: …” sub-tag. Budget spending plus
          reimbursable spending is everything that left your accounts.
        </p>

        <TagSetting config={config} onChange={onConfigChange} />
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold tracking-tight text-ink-900">By bucket</h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-500">
          A bucket is the name after the colon — Healthcare Account, Vacation
          Account — plus any other tags on the row. Two names on one row are counted
          once, under both together, so these always add up to the total above.
          A leftover generic tag with no name after it lands in No bucket.
        </p>

        <div className="mt-4 space-y-1">
          {reimbursable.buckets.map((bucket) => (
            <div key={bucket.label} className="rounded-2xl bg-white/70">
              <button
                onClick={() => setOpenBucket((b) => (b === bucket.label ? null : bucket.label))}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {bucketName(config, bucket.label)}
                    {bucket.label === NO_BUCKET && <Note>tag these to sort them</Note>}
                  </span>
                  <span className="block text-[11px] text-ink-400">
                    {bucket.count} transaction{bucket.count === 1 ? '' : 's'}
                    {owedBy(config, bucket.label) && ` · owed by ${owedBy(config, bucket.label)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {presentIn(bucket.spend).map(([currency, value]) => (
                    <span
                      key={currency}
                      className="block text-sm font-semibold tabular-nums text-ink-900"
                    >
                      {amountIn(Math.abs(value), currency)}
                    </span>
                  ))}
                </span>
              </button>

              {openBucket === bucket.label && (
                <div className="animate-fade border-t border-sand-200">
                  <BucketSettingForm
                    config={config}
                    bucket={bucket.label}
                    onChange={onConfigChange}
                  />
                  <TransactionTable
                    rows={rowsFor(bucket.label)}
                    empty="Nothing here in this period."
                    omitTags={[tag]}
                  />
                </div>
              )}
            </div>
          ))}

          {reimbursable.buckets.length === 0 && (
            <p className="rounded-2xl bg-white/70 px-4 py-8 text-center text-sm text-ink-500">
              Nothing in this period carries the “{tag}” tag. When something does,
              it will gather here by bucket instead of counting against your plan.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * Who owes a bucket, edited where the bucket is rather than on a settings
 * screen. Leaving both fields empty removes the entry, so configuration only
 * ever holds what the user actually said.
 */
function BucketSettingForm({
  config,
  bucket,
  onChange,
}: {
  config: EtmConfig
  bucket: string
  onChange: (config: EtmConfig) => void
}) {
  const current = settingFor(config, bucket)
  const [owner, setOwner] = useState(current?.owedBy ?? '')
  const [name, setName] = useState(current?.displayName ?? '')
  const dirty = owner !== (current?.owedBy ?? '') || name !== (current?.displayName ?? '')

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-sand-200 px-4 py-3">
      <label className="block">
        <span className="label">Owed by</span>
        <input
          className="field w-40 text-sm"
          value={owner}
          placeholder="Nobody yet"
          onChange={(e) => setOwner(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="label">Call it</span>
        <input
          className="field w-56 text-sm"
          value={name}
          placeholder={bucket}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        onClick={() => onChange(withBucketSetting(config, { bucket, owedBy: owner, displayName: name }))}
        className="btn-ghost text-xs"
        disabled={!dirty}
      >
        Save
      </button>
      <p className="w-full text-[11px] text-ink-400">
        Used by the month-end reimbursement step, which turns this into “ask
        {owner ? ` ${owner}` : ' them'} for this much”.
      </p>
    </div>
  )
}

function TagSetting({
  config,
  onChange,
}: {
  config: EtmConfig
  onChange: (config: EtmConfig) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(config.reimbursableTag)

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(config.reimbursableTag)
          setEditing(true)
        }}
        className="mt-3 text-xs text-tide-700 underline underline-offset-2"
      >
        Use a different prefix
      </button>
    )
  }

  const commit = () => {
    const reimbursableTag = draft.trim() || DEFAULT_CONFIG.reimbursableTag
    onChange({ ...config, reimbursableTag })
    setEditing(false)
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="text-xs text-ink-500" htmlFor="reimbursable-tag">
        Tag family prefix
      </label>
      <input
        id="reimbursable-tag"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder={DEFAULT_CONFIG.reimbursableTag}
        className="input w-48 text-sm"
        autoFocus
      />
      <button onClick={commit} className="btn-ghost text-xs">
        Save
      </button>
      <button onClick={() => setEditing(false)} className="btn-ghost text-xs">
        Cancel
      </button>
    </div>
  )
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <span className="ml-2 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wider text-ink-500">
    {children}
  </span>
)

function Figure({ label, money }: { label: string; money: Money }) {
  const parts = presentIn(money)
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      {isEmpty(money) ? (
        <p className="mt-1 text-lg font-semibold text-ink-400">—</p>
      ) : (
        parts.map(([currency, amount]) => (
          <p key={currency} className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
            {amountIn(Math.abs(amount), currency)}
          </p>
        ))
      )}
    </div>
  )
}
