import { useEffect, useState } from 'react'
import EtmArea from './EtmArea'
import EtmGate from './EtmGate'
import { forgetRememberedKey, readVaultMeta, rememberedKey, wipeVault } from '../../lib/etm/storage/vault'

interface Props {
  /** Held by the app so stepping back to the budget does not re-lock. */
  unlockedKey: CryptoKey | null
  onUnlocked: (key: CryptoKey, remembered: boolean) => void
  onLocked: () => void
  onWiped: () => void
  onClose: () => void
}

/**
 * Entry point of the code-split expense tracking bundle. Nothing in this
 * directory — nor the crypto and storage layers it pulls in — is downloaded
 * until the module is asked for, so the app is unchanged for anyone who never
 * opens it.
 */
export default function EtmModule({
  unlockedKey,
  onUnlocked,
  onLocked,
  onWiped,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'checking' | 'setup' | 'unlock'>('checking')

  useEffect(() => {
    if (unlockedKey) return
    let cancelled = false

    void (async () => {
      // The stored meta, not the app's hint, decides which flow to show: it is
      // the thing an unlock actually has to match.
      const meta = await readVaultMeta().catch(() => undefined)
      if (cancelled) return
      if (!meta) {
        setMode('setup')
        return
      }
      const remembered = await rememberedKey()
      if (cancelled) return
      if (remembered) onUnlocked(remembered, true)
      else setMode('unlock')
    })()

    return () => {
      cancelled = true
    }
  }, [unlockedKey, onUnlocked])

  if (unlockedKey) {
    return (
      <EtmArea
        unlockedKey={unlockedKey}
        onClose={onClose}
        onLock={() => {
          void forgetRememberedKey()
          onLocked()
        }}
        onWipe={() => {
          void wipeVault()
          onWiped()
        }}
      />
    )
  }

  if (mode === 'checking') return null

  return <EtmGate mode={mode} onClose={onClose} onUnlocked={onUnlocked} />
}
