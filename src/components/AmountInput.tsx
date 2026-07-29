import { useState } from 'react'

interface Props {
  value: number
  onChange: (value: number) => void
  className?: string
  ariaLabel: string
  autoFocus?: boolean
}

/**
 * Whole-dollar entry.
 *
 * A controlled `<input type="number">` cannot be used here: React compares the
 * DOM value to the incoming prop loosely, so typing `110` into a field showing
 * `0` leaves `"0110"` sitting in the DOM — the numbers are equal, so React
 * never rewrites it. Holding the text in state sidesteps that, and lets us drop
 * leading zeros as they are typed.
 */
export default function AmountInput({ value, onChange, className, ariaLabel, autoFocus }: Props) {
  const [draft, setDraft] = useState<string | null>(null)

  const handle = (text: string) => {
    const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    setDraft(digits)
    onChange(digits === '' ? 0 : Number(digits))
  }

  return (
    <input
      inputMode="numeric"
      value={draft ?? String(Math.round(value))}
      onChange={(e) => handle(e.target.value)}
      onBlur={() => setDraft(null)}
      aria-label={ariaLabel}
      className={className}
      autoFocus={autoFocus}
    />
  )
}
