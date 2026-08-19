import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import CategoryModal from './CategoryModal'
import EtmGate from './EtmGate'
import EtmOpening from './EtmOpening'
import EtmStrip from './EtmStrip'
import { defaultPeriod } from './PeriodSelector'
import { useEtmData } from './useEtmData'
import { aggregate, dashboardActuals, type DashboardActuals } from '../../lib/etm/aggregate'
import { periodLabel, type Period } from '../../lib/etm/period'
import {
  forgetRememberedKey,
  readVaultMeta,
  rememberedKey,
  wipeVault,
} from '../../lib/etm/storage/vault'
import type { Budget } from '../../lib/types'

const EtmArea = lazy(() => import('./EtmArea'))

interface Props {
  /** Held by the app so stepping back to the budget does not re-lock. */
  unlockedKey: CryptoKey | null
  /** Whether the full expenses area is showing, or just the dashboard strip. */
  open: boolean
  budget: Budget
  /** A category the dashboard's group modal asked to see behind. */
  openCategory: string | null
  onCloseCategory: () => void
  onActuals: (actuals: DashboardActuals | null) => void
  onUnlocked: (key: CryptoKey, remembered: boolean) => void
  onLocked: () => void
  onWiped: () => void
  onOpen: () => void
  onClose: () => void
}

/**
 * Entry point of the code-split expense tracking bundle. Nothing in this
 * directory — nor the crypto and storage layers it pulls in — is downloaded
 * until the module is asked for, so the app is unchanged for anyone who never
 * opens it.
 */
export default function EtmModule(props: Props) {
  const { unlockedKey, open, onUnlocked, onClose } = props
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

  if (unlockedKey) return <Unlocked {...props} unlockedKey={unlockedKey} />
  if (mode === 'checking') return open ? <EtmOpening onClose={onClose} /> : null
  return <EtmGate mode={mode} onClose={onClose} onUnlocked={onUnlocked} />
}

function Unlocked({
  unlockedKey,
  open,
  budget,
  openCategory,
  onCloseCategory,
  onActuals,
  onLocked,
  onWiped,
  onOpen,
  onClose,
}: Props & { unlockedKey: CryptoKey }) {
  const data = useEtmData(unlockedKey)
  const [period, setPeriod] = useState<Period>(() => defaultPeriod([]))
  const [periodSettled, setPeriodSettled] = useState(false)

  // The period settles once the months are known, so a fixture or an archive
  // that ends in the past opens on a month that has something in it.
  useEffect(() => {
    if (data.loading || periodSettled) return
    setPeriod(defaultPeriod(data.months))
    setPeriodSettled(true)
  }, [data.loading, data.months, periodSettled])

  const excluded = useMemo(
    () => new Set(data.accounts.filter((a) => a.excludedFromBudget).map((a) => a.id)),
    [data.accounts],
  )

  const reimbursableTag = data.config.reimbursableTag

  const actuals = useMemo(
    () =>
      period
        ? aggregate(data.transactions, period, {
            excludeAccountIds: excluded,
            reimbursableTag,
          })
        : null,
    [data.transactions, period, excluded, reimbursableTag],
  )

  useEffect(() => {
    onActuals(actuals && period ? dashboardActuals(actuals, periodLabel(period)) : null)
  }, [actuals, period, onActuals])

  // The dashboard behind should read as it always has once the module is gone.
  useEffect(() => () => onActuals(null), [onActuals])

  const drillDown = openCategory && (
    <CategoryModal
      category={openCategory}
      period={period}
      transactions={data.transactions}
      excluded={excluded}
      reimbursableTag={reimbursableTag}
      onClose={onCloseCategory}
    />
  )

  if (!open) {
    return (
      <>
        <EtmStrip
          period={period}
          months={data.months}
          income={actuals?.income ?? { CAD: 0, USD: 0 }}
          spend={actuals?.spend ?? { CAD: 0, USD: 0 }}
          reimbursable={actuals?.reimbursable.spend ?? { CAD: 0, USD: 0 }}
          counted={actuals?.counted ?? 0}
          loading={data.loading}
          onPeriodChange={setPeriod}
          onOpen={onOpen}
        />
        {drillDown}
      </>
    )
  }

  return (
    <>
      <Suspense fallback={<EtmOpening afterUnlock onClose={onClose} />}>
        <EtmArea
          data={data}
          budget={budget}
          period={period}
          onPeriodChange={setPeriod}
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
      </Suspense>
      {drillDown}
    </>
  )
}
