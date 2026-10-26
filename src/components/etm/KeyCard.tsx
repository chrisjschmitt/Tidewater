import { useState } from 'react'
import { changeVaultKey, MIN_KEY_LENGTH } from '../../lib/etm/storage/vault'

/**
 * Settings → Expense key. Re-encrypts everything on this device under a new
 * key, while it is still unlocked with the current one — the way back when
 * the key in the password manager turns out not to be the one in use.
 */
export default function KeyCard({
  unlockedKey,
  onKeyChanged,
  onBackUp,
}: {
  unlockedKey: CryptoKey
  onKeyChanged: (key: CryptoKey) => void
  onBackUp: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [first, setFirst] = useState('')
  const [again, setAgain] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  const problem =
    first.length > 0 && first.length < MIN_KEY_LENGTH
      ? `At least ${MIN_KEY_LENGTH} characters.`
      : again.length > 0 && again !== first
        ? 'The two keys are not the same.'
        : ''
  const ready = first.length >= MIN_KEY_LENGTH && first === again && saved && !busy

  const change = async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await changeVaultKey(unlockedKey, first)
      if (!result.ok) {
        setMessage(
          result.reason === 'unavailable'
            ? 'This browser cannot encrypt here, so nothing was changed.'
            : 'This session’s key no longer matches the data, so nothing was changed.',
        )
        return
      }
      onKeyChanged(result.key)
      setFirst('')
      setAgain('')
      setSaved(false)
      setDone(true)
      await onBackUp()
    } catch {
      setMessage('Something went wrong, so nothing was changed. Your data still opens with the current key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold tracking-tight text-ink-900">Expense key</h2>
      <p className="mt-0.5 max-w-prose text-sm text-ink-500">
        Everything here is encrypted with your expense key. If the key in your password manager doesn’t open a backup,
        change the key here while this device is still unlocked: your data is re-encrypted with the new key. Backups made
        before the change still need the old key.
      </p>

      {done && (
        <p className="mt-3 rounded-2xl bg-tide-50 px-4 py-3 text-sm text-tide-700">
          Done — everything on this device now opens with the new key, and a backup was made with it. Test that backup
          in another browser (restore it, unlock with the key from your password manager) before relying on it.
        </p>
      )}

      {!open ? (
        <button className="btn-ghost mt-3 text-xs" onClick={() => setOpen(true)}>
          Change key…
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-2xl bg-sand-100/60 p-4">
          <p className="text-xs text-ink-500">
            Best: have your password manager generate the new key, save it there first, then paste it into both
            fields — so what is saved is exactly what is used.
          </p>
          <label className="block text-xs text-ink-500">
            New key
            <input
              type="password"
              className="field mt-1 w-full"
              autoComplete="new-password"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          </label>
          <label className="block text-xs text-ink-500">
            New key again
            <input
              type="password"
              className="field mt-1 w-full"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </label>
          {problem && <p className="text-xs text-shell-500">{problem}</p>}
          <label className="flex items-center gap-2 text-xs text-ink-700">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            This new key is saved in my password manager
          </label>
          {message && <p className="text-xs text-shell-500">{message}</p>}
          <div className="flex gap-2">
            <button disabled={!ready} className="btn-primary text-xs disabled:opacity-50" onClick={() => void change()}>
              {busy ? 'Re-encrypting…' : 'Change key and back up'}
            </button>
            <button className="btn-quiet text-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
