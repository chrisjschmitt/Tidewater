import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import ChangelogModal from './components/ChangelogModal'
import GoalsPanel from './components/GoalsPanel'
import GroupBars from './components/GroupBars'
import GroupDetail from './components/GroupDetail'
import HelpModal from './components/HelpModal'
import ImportProgress, { type ImportProgressState } from './components/ImportProgress'
import IncomeCard from './components/IncomeCard'
import Modal from './components/Modal'
import Onboarding from './components/Onboarding'
import OptionalFeatureBoundary from './components/OptionalFeatureBoundary'
import EtmOpening from './components/etm/EtmOpening'
import SummaryRing from './components/SummaryRing'
import type { DashboardActuals } from './lib/etm/aggregate'
import {
  balanceTone,
  freeAfterExpenses,
  groupSummaries,
  totalExpenses,
  totalGoalContributions,
  totalIncome,
  unallocated,
  type GroupSummary,
} from './lib/budget'
import {
  DEFAULT_PROFILE,
  detectCsvKind,
  parseBudgetCsv,
  parseTransactionsCsvAsync,
  toBudgetCsv,
  type TransactionImport,
} from './lib/csv'
import { money } from './lib/format'
import {
  DEFAULT_SETTINGS,
  clearBudget,
  clearChat,
  downloadFile,
  loadAll,
  probeEtmPresence,
  saveBudget,
  saveSettings,
  type EtmPresence,
  type Settings,
} from './lib/storage'
import type { Budget, ExpenseLine, Goal, GroupId, IncomeLine } from './lib/types'
import { APP_VERSION } from './lib/version'

/**
 * The optional expense tracking module, in a chunk of its own. Anyone who does
 * not open it never downloads it, which is what keeps the rest of Tidewater
 * exactly the app it was. In `--mode public` builds the ternary is a
 * compile-time `false`, so the chunk is never emitted at all.
 */
const EtmModule = __ETM_AVAILABLE__ ? lazy(() => import('./components/etm/EtmModule')) : null

export default function App() {
  const [budget, setBudget] = useState<Budget | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [etm, setEtm] = useState<EtmPresence | undefined>(undefined)
  const [etmOpen, setEtmOpen] = useState(false)
  const [etmKey, setEtmKey] = useState<CryptoKey | null>(null)
  const [etmState, setEtmActuals] = useState<DashboardActuals | null>(null)
  const [etmCategory, setEtmCategory] = useState<string | null>(null)
  // Folds to a constant null in public builds, so no comparison markup ships.
  const etmActuals = __ETM_AVAILABLE__ ? etmState : null
  const [pendingImport, setPendingImport] = useState<TransactionImport | null>(null)
  const [notice, setNotice] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      // The ternary is compile-time in public builds, so the probe — and the
      // module's storage key with it — tree-shakes out of the bundle.
      const [{ budget: saved, settings: stored, storageOk }, etmPresence] = await Promise.all([
        loadAll(),
        __ETM_AVAILABLE__ ? probeEtmPresence() : undefined,
      ])
      if (saved) setBudget(saved)
      setSettings(stored)
      setEtm(etmPresence)
      setReady(true)
      if (!storageOk) {
        setNotice(
          'This browser is not letting Tidewater read its storage, so nothing will be saved. Close any other Tidewater tabs and reload.',
        )
      }
    })()
  }, [])

  const commit = useCallback((next: Budget) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() }
    setBudget(stamped)
    void saveBudget(stamped)
  }, [])

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next)
    void saveSettings(next)
  }, [])

  const rememberEtmUnlock = useCallback((key: CryptoKey, remembered: boolean) => {
    setEtmKey(key)
    setEtm({ setUp: true, remembered })
  }, [])

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 5000)
  }

  // --- importing --------------------------------------------------------

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true)
      const setPhase = (label: string, percent: number) => {
        setImportProgress({ fileName: file.name, label, percent })
      }

      try {
        setPhase('Reading your file…', 2)
        const text = await readFileText(file, (loaded, total) => {
          const fraction = total > 0 ? loaded / total : 1
          setPhase('Reading your file…', Math.round(fraction * 40))
        })
        setPhase('Reading your file…', 42)

        const looksLikeBackup =
          file.name.toLowerCase().endsWith('.json') ||
          file.type === 'application/json' ||
          text.trimStart().startsWith('{')
        if (looksLikeBackup) {
          setPhase('Restoring your backup…', 70)
          await yieldToUi()
          const restored = JSON.parse(text) as Budget
          if (!restored || !Array.isArray(restored.expenses) || !Array.isArray(restored.income)) {
            throw new Error('That JSON file does not look like a Tidewater backup.')
          }
          setPhase('Restoring your backup…', 95)
          commit({ ...restored, updatedAt: new Date().toISOString() })
          flash('Your backup is restored.')
          return
        }

        if (detectCsvKind(text) === 'transactions') {
          setPhase('Averaging your transactions…', 45)
          const result = await parseTransactionsCsvAsync(text, (fraction) => {
            setPhase('Averaging your transactions…', Math.round(45 + fraction * 50))
          })
          if (result.expenses.length === 0 && result.income.length === 0) {
            flash('I could not find any spending in that file. Is it a transaction export?')
            return
          }
          setPhase('Almost ready…', 100)
          setPendingImport(result)
          return
        }

        setPhase('Loading your budget…', 75)
        await yieldToUi()
        const parsed = parseBudgetCsv(text)
        setPhase('Loading your budget…', 95)
        commit({
          version: 1,
          profile: budget?.profile ?? DEFAULT_PROFILE,
          income: parsed.income,
          expenses: parsed.expenses,
          goals: parsed.goals.length > 0 ? parsed.goals : (budget?.goals ?? []),
          updatedAt: new Date().toISOString(),
          source: 'budget-csv',
        })
        flash(parsed.warnings[0] ?? 'Budget loaded.')
      } catch (err) {
        flash(`That file could not be read: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(false)
        setImportProgress(null)
      }
    },
    [budget, commit],
  )

  const loadSample = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/ted-budget.csv`)
      const parsed = parseBudgetCsv(await res.text())
      commit({
        version: 1,
        profile: {
          ...DEFAULT_PROFILE,
          name: 'Ted',
          region: 'Calgary, Alberta',
          housing: 'rent',
          household: 'single',
        },
        income: parsed.income,
        expenses: parsed.expenses,
        goals: parsed.goals,
        updatedAt: new Date().toISOString(),
        source: 'sample',
      })
      flash('This is Ted’s sample budget. Change anything you like.')
    } catch {
      flash('The sample budget could not be loaded.')
    } finally {
      setBusy(false)
    }
  }, [commit])

  const applyImport = (result: TransactionImport, keepGoals: boolean) => {
    commit({
      version: 1,
      profile: budget?.profile ?? DEFAULT_PROFILE,
      income: result.income,
      expenses: result.expenses,
      goals: keepGoals ? (budget?.goals ?? []) : [],
      updatedAt: new Date().toISOString(),
      source: 'transactions',
      sourceNote: result.note,
    })
    setPendingImport(null)
    flash(`Averaged ${result.transactionCount.toLocaleString()} transactions over ${result.months} months.`)
  }

  // --- derived ----------------------------------------------------------

  const summaries = useMemo(() => (budget ? groupSummaries(budget) : []), [budget])
  const activeSummary = useMemo<GroupSummary | null>(
    () => summaries.find((s) => s.group.id === openGroup) ?? null,
    [summaries, openGroup],
  )

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-400">
        Opening your budget…
      </div>
    )
  }

  if (!budget) {
    return (
      <>
        <Onboarding
          onReady={commit}
          onLoadSample={loadSample}
          onImportFile={(f) => void handleFile(f)}
          onOpenChangelog={() => setChangelogOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          busy={busy}
        />
        <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        <HelpModal
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          onOpenChat={() => {
            setHelpOpen(false)
            setChatOpen(true)
          }}
        />
        {notice && (
          <p className="fixed inset-x-4 bottom-4 mx-auto max-w-md rounded-xl bg-ink-900/90 px-4 py-3 text-center text-xs text-sand-50 shadow-lg">
            {notice}
          </p>
        )}
        {importProgress && <ImportProgress progress={importProgress} />}
        <ImportReview
          result={pendingImport}
          hasGoals={false}
          onCancel={() => setPendingImport(null)}
          onApply={applyImport}
        />
      </>
    )
  }

  const income = totalIncome(budget)
  const spending = totalExpenses(budget)
  const goalMoney = totalGoalContributions(budget)
  const left = unallocated(budget)
  const tone = balanceTone(budget)

  const setExpenses = (lines: ExpenseLine[], groupId: GroupId) =>
    commit({
      ...budget,
      expenses: [...budget.expenses.filter((l) => l.groupId !== groupId), ...lines],
    })

  const setIncome = (lines: IncomeLine[]) => commit({ ...budget, income: lines })
  const setGoals = (goals: Goal[]) => commit({ ...budget, goals })

  return (
    <div className="min-h-screen pb-24">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />

      <header className="sticky top-0 z-30 border-b border-sand-200/70 bg-sand-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <svg width="26" height="26" viewBox="0 0 128 128" aria-hidden>
              <rect width="128" height="128" rx="28" fill="var(--color-tide-600)" />
              <path d="M8 88c14 0 14-10 28-10s14 10 28 10 14-10 28-10 14 10 28 10v40H8z" fill="#d5e8e4" opacity=".9" />
              <circle cx="64" cy="46" r="15" fill="#faf8f3" opacity=".9" />
            </svg>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-tide-700">
                  Tidewater
                </span>
                <button
                  type="button"
                  onClick={() => setChangelogOpen(true)}
                  className="rounded px-1 py-0.5 text-[11px] tabular-nums text-ink-400 transition hover:bg-sand-100 hover:text-tide-700"
                  aria-label={`Version ${APP_VERSION}. View changelog.`}
                  title="What’s new"
                >
                  v{APP_VERSION}
                </button>
              </div>
              <span className="block text-[11px] text-ink-400">
                {budget.profile.name ? `${budget.profile.name}’s plan` : 'Your plan'}
                {budget.source === 'sample' && ' · sample'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {notice && (
              <span className="hidden max-w-md truncate text-xs text-ink-500 sm:block animate-fade">
                {notice}
              </span>
            )}
            {etmKey && (
              <button onClick={() => setEtmOpen(true)} className="btn-quiet text-xs">
                Expenses
              </button>
            )}
            <button onClick={() => setHelpOpen(true)} className="btn-quiet text-xs">
              Help
            </button>
            <button onClick={() => fileRef.current?.click()} className="btn-quiet text-xs">
              Import
            </button>
            <button onClick={() => setDataOpen(true)} className="btn-quiet text-xs">
              Your data
            </button>
            <button onClick={() => setChatOpen(true)} className="btn-primary text-xs">
              Ask a question
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {(etmOpen || etmKey) && EtmModule && (
          <OptionalFeatureBoundary
            onDismiss={() => {
              setEtmOpen(false)
              setEtmKey(null)
              setEtmActuals(null)
            }}
          >
            <Suspense fallback={etmOpen ? <EtmOpening onClose={() => setEtmOpen(false)} /> : null}>
              <EtmModule
                open={etmOpen}
                unlockedKey={etmKey}
                budget={budget}
                openCategory={etmCategory}
                onCloseCategory={() => setEtmCategory(null)}
                onActuals={setEtmActuals}
                onUnlocked={rememberEtmUnlock}
                onOpen={() => setEtmOpen(true)}
                onClose={() => setEtmOpen(false)}
                onLocked={() => {
                  setEtmKey(null)
                  setEtm({ setUp: true, remembered: false })
                  setEtmOpen(false)
                }}
                onWiped={() => {
                  setEtmKey(null)
                  setEtm(undefined)
                  setEtmOpen(false)
                  flash('Expense tracking data was erased. Your budget is untouched.')
                }}
              />
            </Suspense>
          </OptionalFeatureBoundary>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
          <div className="space-y-6">
            <section className="card p-6">
              <h1 className="text-lg font-semibold leading-snug tracking-tight text-ink-900">
                {tone.headline}
              </h1>
              <p className="mt-1 text-sm text-ink-500">{tone.detail}</p>
              <div className="mt-6">
                <SummaryRing
                  income={income}
                  spending={spending}
                  goals={goalMoney}
                  actuals={etmActuals}
                />
              </div>
            </section>

            <IncomeCard income={budget.income} onChange={setIncome} />
          </div>

          <section className="card p-6">
            <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-ink-900">
                  Where it goes
                </h2>
                <p className="mt-0.5 text-sm text-ink-500">
                  {etmActuals
                    ? `Planned above, spent below, for ${etmActuals.label}. Open any group to adjust the plan.`
                    : 'Largest first. Open any group to adjust what is inside it.'}
                </p>
              </div>
              <div className="text-right">
                <span className="block text-sm font-semibold tabular-nums text-ink-900">
                  {money(spending * (etmActuals?.months ?? 1))}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {etmActuals
                    ? `spent ${money(etmActuals.spend.CAD)}`
                    : `across ${budget.expenses.length} items`}
                </span>
              </div>
            </header>

            <GroupBars
              summaries={summaries}
              onOpen={(s) => setOpenGroup(s.group.id)}
              actuals={etmActuals}
            />

            {budget.sourceNote && (
              <p className="mt-5 border-t border-sand-200 pt-4 text-xs text-ink-400">
                {budget.sourceNote}
              </p>
            )}
          </section>
        </div>

        <div className="mt-6">
          <GoalsPanel
            goals={budget.goals}
            available={freeAfterExpenses(budget) - goalMoney}
            capacity={freeAfterExpenses(budget)}
            onChange={setGoals}
          />
        </div>
      </main>

      <GroupDetail
        summary={activeSummary}
        unallocated={left}
        onClose={() => {
          setOpenGroup(null)
          setEtmCategory(null)
        }}
        onChange={(lines) => activeSummary && setExpenses(lines, activeSummary.group.id)}
        actuals={etmActuals}
        onOpenCategory={etmActuals ? setEtmCategory : undefined}
      />

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        budget={budget}
        settings={settings}
        onSettingsChange={updateSettings}
      />

      <ImportReview
        result={pendingImport}
        hasGoals={budget.goals.length > 0}
        onCancel={() => setPendingImport(null)}
        onApply={applyImport}
      />

      <DataModal
        open={dataOpen}
        budget={budget}
        etm={etm}
        onClose={() => setDataOpen(false)}
        onOpenEtm={() => {
          setDataOpen(false)
          setEtmOpen(true)
        }}
        onImportBackup={(file) => {
          setDataOpen(false)
          void handleFile(file)
        }}
        onReset={() => {
          void clearBudget()
          void clearChat()
          setBudget(null)
          setDataOpen(false)
        }}
        onLoadSample={() => {
          setDataOpen(false)
          void loadSample()
        }}
      />

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onOpenChat={() => {
          setHelpOpen(false)
          setChatOpen(true)
        }}
      />

      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-tide-600 text-white shadow-lg transition hover:bg-tide-700 hover:shadow-xl"
          aria-label="Ask a question about your budget"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      )}

      {importProgress && <ImportProgress progress={importProgress} />}
    </div>
  )
}

function ImportReview({
  result,
  hasGoals,
  onCancel,
  onApply,
}: {
  result: TransactionImport | null
  hasGoals: boolean
  onCancel: () => void
  onApply: (result: TransactionImport, keepGoals: boolean) => void
}) {
  if (!result) return null
  const incomeTotal = result.income.reduce((s, l) => s + l.amount, 0)
  const spendTotal = result.expenses.reduce((s, l) => s + l.amount, 0)

  return (
    <Modal
      open
      onClose={onCancel}
      title="Here is what I found"
      subtitle={result.note}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">
            Not now
          </button>
          <button onClick={() => onApply(result, hasGoals)} className="btn-primary">
            Use these as my budget
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Average monthly income" value={money(incomeTotal)} />
        <Stat label="Average monthly spending" value={money(spendTotal)} />
        <Stat
          label="Left over"
          value={money(incomeTotal - spendTotal)}
          tone={incomeTotal - spendTotal >= 0 ? 'good' : 'warn'}
        />
      </div>

      <p className="mt-5 text-xs leading-relaxed text-ink-500">
        Transfers between your own accounts and credit card payments were left out —{' '}
        {result.skippedInternal.toLocaleString()} of them — because they move money rather than
        spend it. Refunds and reimbursements are netted against the category they came from.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Column title="Income" lines={result.income.slice(0, 8)} />
        <Column title="Largest spending" lines={result.expenses.slice(0, 8)} />
      </div>
    </Modal>
  )
}

function Column({ title, lines }: { title: string; lines: Array<{ name: string; amount: number }> }) {
  return (
    <div>
      <h3 className="label mb-2">{title}</h3>
      <ul className="space-y-1">
        {lines.map((l) => (
          <li key={l.name} className="flex justify-between gap-3 text-sm">
            <span className="truncate text-ink-700">{l.name}</span>
            <span className="shrink-0 tabular-nums text-ink-500">{money(l.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'warn'
}) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'warn' ? 'text-shell-500' : tone === 'good' ? 'text-tide-700' : 'text-ink-900'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function DataModal({
  open,
  budget,
  etm,
  onClose,
  onImportBackup,
  onReset,
  onLoadSample,
  onOpenEtm,
}: {
  open: boolean
  budget: Budget
  etm?: EtmPresence
  onClose: () => void
  onImportBackup: (file: File) => void
  onReset: () => void
  onLoadSample: () => void
  onOpenEtm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const backupRef = useRef<HTMLInputElement>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your data"
      subtitle="It lives in this browser, on this device, and nowhere else."
      width="max-w-lg"
    >
      <input
        ref={backupRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onImportBackup(file)
          e.target.value = ''
        }}
      />
      <div className="space-y-3">
        <Row
          title="Export as a budget file"
          body="A small CSV you can edit in any spreadsheet, or load on another device."
          action="Download CSV"
          onClick={() =>
            downloadFile(
              `tidewater-budget-${new Date().toISOString().slice(0, 10)}.csv`,
              toBudgetCsv(budget),
            )
          }
        />
        <Row
          title="Export a full backup"
          body="Everything, including goals and your profile, as a JSON file."
          action="Download JSON"
          onClick={() =>
            downloadFile(
              `tidewater-backup-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(budget, null, 2),
              'application/json',
            )
          }
        />
        <Row
          title="Restore a full backup"
          body="Replace what is on screen with a Tidewater JSON backup from this or another device."
          action="Choose JSON"
          onClick={() => backupRef.current?.click()}
        />
        {__ETM_AVAILABLE__ && (
          <Row
            title={etm?.setUp ? 'Expense tracking' : 'Enable expense tracking…'}
            body={
              etm?.setUp
                ? 'Your real spending, encrypted on this device and kept apart from your budget.'
                : 'Optional. Track what you actually spent alongside your plan, encrypted with a key you choose.'
            }
            action={etm?.setUp ? (etm.remembered ? 'Open' : 'Unlock') : 'Set up'}
            onClick={onOpenEtm}
          />
        )}
        <Row
          title="Load Ted’s sample budget"
          body="Replaces what is on screen with the example plan."
          action="Load sample"
          onClick={onLoadSample}
        />

        <div className="rounded-2xl border border-shell-300/50 bg-shell-300/10 px-4 py-3.5">
          <p className="text-sm font-medium text-ink-900">Start over</p>
          <p className="mt-0.5 text-xs text-ink-500">
            Erases the budget and chat history stored in this browser. Export first if you might
            want the budget back.
          </p>
          {confirming ? (
            <div className="mt-3 flex gap-2">
              <button onClick={onReset} className="btn bg-shell-500 text-white hover:opacity-90">
                Yes, erase it
              </button>
              <button onClick={() => setConfirming(false)} className="btn-ghost">
                Keep it
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className="btn-ghost mt-3">
              Erase my data
            </button>
          )}
        </div>

        <p className="pt-1 text-[11px] text-ink-400">
          Tidewater {APP_VERSION} · Last changed {new Date(budget.updatedAt).toLocaleString()}
        </p>
      </div>
    </Modal>
  )
}

function Row({
  title,
  body,
  action,
  onClick,
}: {
  title: string
  body: string
  action: string
  onClick: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/70 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="mt-0.5 text-xs text-ink-500">{body}</p>
      </div>
      <button onClick={onClick} className="btn-ghost shrink-0 text-xs">
        {action}
      </button>
    </div>
  )
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function readFileText(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
      else if (file.size > 0) onProgress?.(Math.min(e.loaded, file.size), file.size)
    }
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'))
    reader.readAsText(file)
  })
}
