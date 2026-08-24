import { useEffect, useState, type ReactNode } from 'react'
import Modal from '../Modal'
import { amountIn } from '../../lib/etm/format'
import { monthName } from '../../lib/etm/period'
import type { CategoryForecast, DoubleCountWarning, ExpenseType } from '../../lib/forecast/types'
import { confidenceLabel, doubleCountCopy, seenCopy, typeLabel } from './forecastCopy'

interface Props {
  categories: CategoryForecast[]
  selected: CategoryForecast | null
  focusedMonth: string
  doubleCounts: DoubleCountWarning[]
  onSelect: (key: string | null) => void
  onPin: (draft: { category: string; amount: number; recurrence: 'once' | 'annual' }) => void
  onOverrideType: (key: string, type: ExpenseType | 'auto') => void
  onOverrideMonths: (key: string, typicalMonths: number[]) => void
  /** Explicit type override for the open card; omitted means History. */
  overrideType?: ExpenseType
}

const TYPE_CHOICES: Array<[ExpenseType | 'auto', string]> = [
  ['auto', 'History'],
  ['predictable-monthly', 'Monthly'],
  ['variable-monthly', 'Variable'],
  ['predictable-annual', 'Annual'],
  ['seasonal', 'Seasonal'],
  ['irregular', 'Irregular'],
]

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function ForecastCategories({
  categories,
  selected,
  focusedMonth,
  doubleCounts,
  onSelect,
  onPin,
  onOverrideType,
  onOverrideMonths,
  overrideType,
}: Props) {
  if (categories.length === 0) return null

  const subtitle = selected
    ? selected.overridden
      ? `${typeLabel(selected.type, selected.lowSample)} · set by you`
      : typeLabel(selected.type, selected.lowSample)
    : undefined

  return (
    <>
      <section className="card p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Household categories</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-500">
            How each line has been showing up. One or two occurrences stay flagged, never promoted
            to a yearly bill on their own.
          </p>
        </header>

        <ul className="divide-y divide-sand-200/80">
          {categories.map((category) => (
            <li key={category.key}>
              <button
                onClick={() => onSelect(category.key)}
                className="flex w-full items-baseline justify-between gap-4 py-2.5 text-left hover:bg-white/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{category.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge>{typeLabel(category.type, category.lowSample)}</Badge>
                    {category.overridden && <Badge quiet>set by you</Badge>}
                    {category.lowSample && <Badge quiet>low sample</Badge>}
                    {category.typicalMonthNames.length > 0 &&
                      category.type !== 'predictable-monthly' &&
                      category.type !== 'variable-monthly' && (
                        <span className="text-[11px] text-ink-400">
                          usually {category.typicalMonthNames.join(', ')}
                        </span>
                      )}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-ink-700">
                  {amountIn(category.setAsideShare, 'CAD')}
                  <span className="ml-1 text-[11px] font-normal text-ink-400">/mo</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Modal open={selected !== null} onClose={() => onSelect(null)} title={selected?.label ?? ''} subtitle={subtitle}>
        {selected && (
          <CategoryDetail
            category={selected}
            focusedMonth={focusedMonth}
            doubleCounts={doubleCounts}
            onPin={onPin}
            overrideType={overrideType}
            onOverrideType={(type) => onOverrideType(selected.key, type)}
            onOverrideMonths={(months) => onOverrideMonths(selected.key, months)}
          />
        )}
      </Modal>
    </>
  )
}

function pinDefault(category: CategoryForecast): number {
  if (category.likely > 0) return category.likely
  if (category.lastAmount > 0) return category.lastAmount
  return category.meanPresent
}

function CategoryDetail({
  category,
  focusedMonth,
  doubleCounts,
  onPin,
  overrideType,
  onOverrideType,
  onOverrideMonths,
}: {
  category: CategoryForecast
  focusedMonth: string
  doubleCounts: DoubleCountWarning[]
  onPin: (draft: { category: string; amount: number; recurrence: 'once' | 'annual' }) => void
  overrideType?: ExpenseType
  onOverrideType: (type: ExpenseType | 'auto') => void
  onOverrideMonths: (typicalMonths: number[]) => void
}) {
  const defaultAmount = pinDefault(category)
  const [amount, setAmount] = useState(defaultAmount)
  const [recurrence, setRecurrence] = useState<'once' | 'annual'>('once')
  const mm = Number(focusedMonth.slice(5, 7))
  const typicalHit =
    (category.type === 'predictable-annual' || category.type === 'seasonal') &&
    category.typicalMonths.includes(mm)
  const warned =
    typicalHit ||
    doubleCounts.some(
      (warning) => warning.month === focusedMonth && warning.category === category.label,
    )
  const selectedType: ExpenseType | 'auto' = overrideType ?? 'auto'
  const lumpy = category.type === 'seasonal' || category.type === 'predictable-annual'
  const historyDiffers = category.type !== category.suggestedType

  useEffect(() => {
    setAmount(defaultAmount)
    setRecurrence('once')
  }, [category.key, defaultAmount])

  const toggleMonth = (month: number) => {
    const next = category.typicalMonths.includes(month)
      ? category.typicalMonths.filter((value) => value !== month)
      : [...category.typicalMonths, month]
    onOverrideMonths(next)
  }

  return (
    <div className="space-y-4 text-sm text-ink-500">
      <p>
        {confidenceLabel(category.confidence)}. {seenCopy(category.occurrences, category.typicalMonthNames)}
      </p>

      {category.typicalMonthNames.length > 0 && !lumpy && (
        <p>
          Typical month{category.typicalMonthNames.length === 1 ? '' : 's'}:{' '}
          {category.typicalMonthNames.join(', ')}.
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Stat label="Likely" value={amountIn(category.likely, 'CAD')} />
        <Stat label="When it is present" value={amountIn(category.meanPresent, 'CAD')} />
        <Stat label="Last 12 months, monthly" value={amountIn(category.average12, 'CAD')} />
        {category.average24 != null && (
          <Stat label="Last 24 months, monthly" value={amountIn(category.average24, 'CAD')} />
        )}
      </dl>

      {category.average24 != null && category.average12 > category.average24 * 1.15 && (
        <p>This category has been running higher lately than the longer window.</p>
      )}

      {category.drift && <p>{sentenceCase(category.drift)}.</p>}

      <div className="rounded-2xl bg-white/70 px-4 py-4">
        <p className="text-[11px] uppercase tracking-wider text-ink-400">How this line is forecast</p>
        <p className="mt-1">
          {historyDiffers
            ? `History called this ${typeLabel(category.suggestedType, category.lowSample).toLowerCase()}. Seasonal and annual land only on the months you check — they do not add on top of the monthly plan.`
            : 'Seasonal and annual land only on the months you check. That does not add on top of the monthly plan, and it leaves the overlay if the line was irregular.'}
        </p>

        <div className="mt-3 flex flex-wrap gap-1">
          {TYPE_CHOICES.map(([id, label]) => {
            const active = selectedType === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => onOverrideType(id)}
                className={
                  active
                    ? 'rounded-full bg-tide-600 px-3 py-1.5 text-xs font-medium text-white'
                    : 'btn-quiet text-xs'
                }
              >
                {label}
              </button>
            )
          })}
        </div>

        {lumpy && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-400">Typical months</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {MONTH_SHORT.map((label, index) => {
                const month = index + 1
                const active = category.typicalMonths.includes(month)
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={active}
                    aria-label={label}
                    onClick={() => toggleMonth(month)}
                    className={
                      active
                        ? 'rounded-full bg-tide-600 px-2.5 py-1 text-xs font-medium text-white'
                        : 'btn-quiet text-xs'
                    }
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white/70 px-4 py-4">
        <p className="text-[11px] uppercase tracking-wider text-ink-400">Pin as known future</p>
        <p className="mt-1">
          Give this cost a month — {monthName(focusedMonth)} — so it leaves the overlay if it is
          irregular, and sits on the calendar if it is not.
        </p>

        {warned && <p className="mt-2">{doubleCountCopy(category.label, monthName(focusedMonth))}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="field w-28 py-1.5 text-sm tabular-nums"
            inputMode="decimal"
            aria-label={`Amount to pin for ${category.label}`}
            value={amount || ''}
            onChange={(event) => setAmount(Number(event.target.value.replace(/[^0-9.]/g, '')) || 0)}
          />
          <div className="flex gap-1">
            {(
              [
                ['once', 'Once'],
                ['annual', 'Each year'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setRecurrence(id)}
                className={
                  recurrence === id
                    ? 'rounded-full bg-tide-600 px-3 py-1.5 text-xs font-medium text-white'
                    : 'btn-quiet text-xs'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onPin({ category: category.label, amount, recurrence })}
            className="btn-ghost text-xs"
            disabled={!(amount > 0)}
          >
            Pin in {monthName(focusedMonth)}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-1 text-base font-semibold tabular-nums text-ink-900">{value}</dd>
    </div>
  )
}

const Badge = ({ children, quiet }: { children: ReactNode; quiet?: boolean }) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[10px] font-normal uppercase tracking-wider ${
      quiet ? 'bg-sand-200 text-ink-500' : 'bg-tide-50 text-tide-700'
    }`}
  >
    {children}
  </span>
)

function sentenceCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
