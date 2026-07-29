import { useRef, useState } from 'react'
import { money } from '../lib/format'
import { EMPTY_ANSWERS, buildStarterBudget, type StarterAnswers } from '../lib/starter'
import type { Budget } from '../lib/types'
import { APP_VERSION } from '../lib/version'

interface Props {
  onReady: (budget: Budget) => void
  onLoadSample: () => void
  onImportFile: (file: File) => void
  onOpenChangelog: () => void
  onOpenHelp?: () => void
  busy?: boolean
}

type Screen = 'welcome' | 'wizard'

export default function Onboarding({
  onReady,
  onLoadSample,
  onImportFile,
  onOpenChangelog,
  onOpenHelp,
  busy,
}: Props) {
  const [screen, setScreen] = useState<Screen>('welcome')
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onImportFile(file)
          e.target.value = ''
        }}
      />

      {screen === 'welcome' ? (
        <div className="animate-rise">
          <Wordmark onOpenChangelog={onOpenChangelog} />
          <h1 className="mt-8 text-4xl font-semibold leading-tight tracking-tight text-ink-900">
            You likely have more than you think.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-500">
            Tidewater is a quiet place to see where your money already goes, and to point what is
            left toward the life you actually want. Nothing you enter leaves this device.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <Choice
              title="Start fresh"
              body="Five short questions and you will have a working budget."
              onClick={() => setScreen('wizard')}
              primary
            />
            <Choice
              title="Import a file"
              body="A Tidewater budget, or a year of transactions from Monarch Money."
              onClick={() => fileRef.current?.click()}
            />
            <Choice
              title="Look around first"
              body="Explore with Ted’s sample budget. Nothing is saved over your own."
              onClick={onLoadSample}
            />
          </div>

          {busy && <p className="mt-6 text-sm text-ink-400">Reading your file…</p>}

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-xs leading-relaxed text-ink-400">
            <span>
              Your budget is stored in this browser only. There is no account, no server, and no
              tracking. You can export everything at any time.
            </span>
            {onOpenHelp && (
              <button
                type="button"
                onClick={onOpenHelp}
                className="shrink-0 text-tide-700 underline underline-offset-2 hover:text-tide-800"
              >
                Help & guide
              </button>
            )}
          </div>
        </div>
      ) : (
        <Wizard onBack={() => setScreen('welcome')} onDone={onReady} />
      )}
    </div>
  )
}

function Wordmark({ onOpenChangelog }: { onOpenChangelog: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 128 128" aria-hidden>
        <rect width="128" height="128" rx="28" fill="var(--color-tide-600)" />
        <path d="M8 78c14 0 14-10 28-10s14 10 28 10 14-10 28-10 14 10 28 10v42H8z" fill="#8fc4bb" opacity=".55" />
        <path d="M8 92c14 0 14-10 28-10s14 10 28 10 14-10 28-10 14 10 28 10v36H8z" fill="#d5e8e4" opacity=".85" />
        <circle cx="64" cy="44" r="16" fill="#faf8f3" opacity=".9" />
      </svg>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold uppercase tracking-[0.22em] text-tide-700">
          Tidewater
        </span>
        <button
          type="button"
          onClick={onOpenChangelog}
          className="rounded px-1 py-0.5 text-xs tabular-nums text-ink-400 transition hover:bg-sand-100 hover:text-tide-700"
          aria-label={`Version ${APP_VERSION}. View changelog.`}
          title="What’s new"
        >
          v{APP_VERSION}
        </button>
      </div>
    </div>
  )
}

function Choice({
  title,
  body,
  onClick,
  primary = false,
}: {
  title: string
  body: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-3xl border p-5 text-left transition ${
        primary
          ? 'border-tide-600 bg-tide-600 text-white hover:bg-tide-700'
          : 'border-sand-200 bg-white/70 hover:border-tide-300 hover:bg-white'
      }`}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className={`mt-1 block text-xs leading-relaxed ${primary ? 'text-tide-50/90' : 'text-ink-500'}`}>
        {body}
      </span>
    </button>
  )
}

const STEPS = ['Income', 'Home', 'Household', 'Debt', 'Ready'] as const

function Wizard({ onBack, onDone }: { onBack: () => void; onDone: (b: Budget) => void }) {
  const [step, setStep] = useState(0)
  const [a, setA] = useState<StarterAnswers>(EMPTY_ANSWERS)
  const set = (patch: Partial<StarterAnswers>) => setA((prev) => ({ ...prev, ...patch }))

  const canAdvance =
    step === 0 ? a.monthlyIncome > 0 : step === 1 ? a.housingCost > 0 : true

  const next = () => (step === STEPS.length - 1 ? onDone(buildStarterBudget(a)) : setStep(step + 1))

  return (
    <div className="card animate-rise p-8">
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 flex-col gap-1.5">
            <div
              className={`h-1 rounded-full transition-colors ${
                i <= step ? 'bg-tide-600' : 'bg-sand-200'
              }`}
            />
            <span className={`text-[10px] uppercase tracking-wider ${i <= step ? 'text-tide-700' : 'text-ink-400'}`}>
              {s}
            </span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <Step
          title="What lands in your account each month?"
          hint="Take-home pay, after tax and deductions. A rough number is fine — you can refine it later."
        >
          <MoneyInput
            value={a.monthlyIncome}
            onChange={(v) => set({ monthlyIncome: v })}
            placeholder="5,850"
            autoFocus
          />
          <input
            value={a.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Your name (optional)"
            className="field mt-3"
          />
        </Step>
      )}

      {step === 1 && (
        <Step title="Where do you live?" hint="Housing is usually the largest single piece, so it is worth getting close.">
          <Segmented
            value={a.housing}
            onChange={(v) => set({ housing: v as StarterAnswers['housing'] })}
            options={[
              { value: 'rent', label: 'I rent' },
              { value: 'own', label: 'I own' },
              { value: 'other', label: 'Something else' },
            ]}
          />
          <label className="label mt-5 block">
            {a.housing === 'own' ? 'Mortgage payment' : 'Rent'} each month
          </label>
          <MoneyInput
            value={a.housingCost}
            onChange={(v) => set({ housingCost: v })}
            placeholder="1,650"
          />
        </Step>
      )}

      {step === 2 && (
        <Step title="Who is this budget for?" hint="This only shapes the starting numbers. Nothing is assumed about you beyond it.">
          <Segmented
            value={a.household}
            onChange={(v) => set({ household: v as StarterAnswers['household'] })}
            options={[
              { value: 'single', label: 'Just me' },
              { value: 'partnered', label: 'Me and a partner' },
            ]}
          />
          <label className="label mt-5 block">Children or others who depend on you</label>
          <div className="mt-2 flex items-center gap-2">
            {[0, 1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => set({ dependents: n })}
                className={`h-10 w-10 rounded-full text-sm font-medium transition ${
                  a.dependents === n
                    ? 'bg-tide-600 text-white'
                    : 'bg-sand-100 text-ink-700 hover:bg-sand-200'
                }`}
              >
                {n === 4 ? '4+' : n}
              </button>
            ))}
          </div>
        </Step>
      )}

      {step === 3 && (
        <Step title="Is there debt you are carrying?" hint="No judgement here. Knowing the number is what makes it shrink.">
          <Segmented
            value={a.hasDebt ? 'yes' : 'no'}
            onChange={(v) => set({ hasDebt: v === 'yes' })}
            options={[
              { value: 'no', label: 'Nothing right now' },
              { value: 'yes', label: 'Yes, some' },
            ]}
          />
          {a.hasDebt && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 animate-fade">
              <div>
                <label className="label mb-2 block">Balance owing</label>
                <MoneyInput value={a.debtBalance} onChange={(v) => set({ debtBalance: v })} placeholder="5,000" />
              </div>
              <div>
                <label className="label mb-2 block">Paying each month</label>
                <MoneyInput value={a.debtPayment} onChange={(v) => set({ debtPayment: v })} placeholder="250" />
              </div>
            </div>
          )}
        </Step>
      )}

      {step === 4 && (
        <Step
          title="That is everything I need."
          hint="I have sketched a realistic starting plan from what you told me. Every line is yours to move."
        >
          <div className="rounded-2xl bg-tide-50 px-5 py-4 text-sm text-ink-700">
            <p>
              Working from <strong>{money(a.monthlyIncome)}</strong> a month
              {a.housingCost > 0 && (
                <>
                  , with <strong>{money(a.housingCost)}</strong> toward {a.housing === 'own' ? 'your mortgage' : 'rent'}
                </>
              )}
              .
            </p>
            <p className="mt-2 text-ink-500">
              Nothing is fixed. Open any group on the dashboard and slide it until it matches your
              real life.
            </p>
          </div>
        </Step>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={() => (step === 0 ? onBack() : setStep(step - 1))}
          className="btn-quiet"
        >
          ← Back
        </button>
        <button onClick={next} disabled={!canAdvance} className="btn-primary">
          {step === STEPS.length - 1 ? 'Open my dashboard' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

function Step({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="animate-fade">
      <h2 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-500">{hint}</p>
      <div className="mt-6">{children}</div>
    </div>
  )
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: number
  onChange: (v: number) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-ink-400">
        $
      </span>
      <input
        type="number"
        min={0}
        step={25}
        value={value || ''}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="field py-3 pl-9 text-lg tabular-nums"
      />
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-sand-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
            value === o.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
