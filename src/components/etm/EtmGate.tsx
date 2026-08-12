import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { MIN_KEY_LENGTH, createVault, unlockVault } from '../../lib/etm/storage/vault'

interface Props {
  /** Setup asks for the key twice; unlock has an existing vault to open. */
  mode: 'setup' | 'unlock'
  onClose: () => void
  onUnlocked: (key: CryptoKey, remembered: boolean) => void
}

export default function EtmGate({ mode, onClose, onUnlocked }: Props) {
  const [key, setKey] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const setup = mode === 'setup'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (setup) {
      if (key.length < MIN_KEY_LENGTH) {
        setError(`Please use at least ${MIN_KEY_LENGTH} characters.`)
        return
      }
      if (key !== confirm) {
        setError('Those two do not match.')
        return
      }
    } else if (key.length === 0) {
      return
    }

    setWorking(true)
    try {
      const result = setup ? await createVault(key, remember) : await unlockVault(key, remember)
      if (result.ok) {
        onUnlocked(result.key, remember)
        return
      }
      setError(
        result.reason === 'unavailable'
          ? 'This browser will not let Tidewater encrypt anything here. Expense tracking needs a secure (https) page.'
          : 'That key does not open this device’s expense data.',
      )
      setKey('')
      setConfirm('')
    } catch {
      setError('Something went wrong setting that up. Nothing was saved.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title={setup ? 'Enable expense tracking' : 'Unlock expense tracking'}
      subtitle={
        setup
          ? 'Choose the key for this device. Everything the module stores is encrypted with it.'
          : 'Enter the key this device’s expense data was set up with.'
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div>
          <label className="label mb-1.5" htmlFor="etm-key">
            Key
          </label>
          <input
            id="etm-key"
            type="password"
            autoFocus
            autoComplete={setup ? 'new-password' : 'current-password'}
            className="field"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={working}
          />
        </div>

        {setup && (
          <div>
            <label className="label mb-1.5" htmlFor="etm-key-confirm">
              Key again
            </label>
            <input
              id="etm-key-confirm"
              type="password"
              autoComplete="new-password"
              className="field"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={working}
            />
          </div>
        )}

        <label className="flex items-start gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-tide-600"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={working}
          />
          <span>
            Stay unlocked on this device
            <span className="mt-0.5 block text-xs text-ink-400">
              Skips the key next time. Leave this off on a shared computer.
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-shell-500">{error}</p>}

        <p className="rounded-2xl bg-white/70 px-4 py-3 text-xs leading-relaxed text-ink-500">
          {setup
            ? 'There is no way to reset this key — no server holds it. If it is ever forgotten, the expense data on this device can be erased and imported again from Monarch.'
            : 'If this key has been forgotten, the expense data here can be erased and imported again from Monarch. Nothing else in Tidewater is affected.'}
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost" disabled={working}>
            Not now
          </button>
          <button type="submit" className="btn-primary" disabled={working || key.length === 0}>
            {working ? 'One moment…' : setup ? 'Enable' : 'Unlock'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
