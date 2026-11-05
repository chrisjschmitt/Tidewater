import { useMemo, useState } from 'react'
import type { EtmData } from './useEtmData'
import { bucketLabel, bucketOf, isReimbursable } from '../../lib/etm/tags'
import {
  DEFAULT_CONFIG,
  bucketName,
  owedBy,
  settingFor,
  withBucketSetting,
  type EtmConfig,
} from '../../lib/etm/config'

/**
 * Settings → Reimbursable: the tag family prefix, and for each bucket who
 * owes it and what to call it (used by Month end's reimbursements).
 */
export default function ReimbursableSettingsCard({ data }: { data: EtmData }) {
  const [open, setOpen] = useState<string | null>(null)
  const config = data.config
  const onChange = (next: EtmConfig) => void data.saveSettings(next)
  const buckets = useMemo(() => {
    const seen = new Set(config.buckets.map((b) => b.bucket))
    for (const t of data.transactions) {
      if (!t.internal && isReimbursable(t, config.reimbursableTag)) seen.add(bucketLabel(bucketOf(t, config.reimbursableTag)))
    }
    return [...seen].sort((a, z) => a.localeCompare(z))
  }, [data.transactions, config.buckets, config.reimbursableTag])

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Reimbursable buckets</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        A bucket is the name after “{config.reimbursableTag}:”. Say who owes each one and what to call it; Month end
        uses these for the reimbursements.
      </p>
      <ul className="mt-4 space-y-1">
        {buckets.map((bucket) => (
          <li key={bucket} className="rounded-2xl bg-white/70">
            <button
              type="button"
              onClick={() => setOpen(open === bucket ? null : bucket)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            >
              <span className="text-sm text-ink-900">{bucketName(config, bucket)}</span>
              <span className="text-[11px] text-ink-400">
                {owedBy(config, bucket) ? `owed by ${owedBy(config, bucket)}` : 'nobody named'} {open === bucket ? '▾' : '▸'}
              </span>
            </button>
            {open === bucket && <BucketSettingForm config={config} bucket={bucket} onChange={onChange} />}
          </li>
        ))}
      </ul>
      <TagSetting config={config} onChange={onChange} />
    </section>
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

