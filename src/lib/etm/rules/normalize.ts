/**
 * Turning what a bank printed into a key that stays the same from one
 * purchase to the next. `METRO 990`, `METRO  990` and `METRO 426` are one
 * merchant; `SQ *ECOTAY` and `ECOTAY` are one merchant; `AMZN Mktp CA*5A43K7E11`
 * is Amazon whatever the order number.
 *
 * Transfers are the exception: the account on the other end is the whole
 * meaning of the row (a fund, an allowance, an own account), so its number
 * stays in the key — `TFR-TO 1234567`, `PTS TO 12345678901`.
 */

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

const PROCESSOR = /^(SQ \*|TST-|TST\* |PAYU\*AR\*|MERPAGO\*|SP |PP\*|DD \*|PAYPAL \*|BKG\*|NMX\*|SUMUP \*)/

export function statementKey(description: string): string {
  const upper = collapse(description).toUpperCase()

  const transfer = /\bTFR-(TO|FR) (\S+)/.exec(upper)
  if (transfer) return `TFR-${transfer[1]} ${transfer[2]}`
  const points = /^PTS (TO|FRM):\s*(\d+)/.exec(upper)
  if (points) return `PTS ${points[1]} ${points[2]}`

  let s = upper.replace(PROCESSOR, '')
  s = s.replace(/(AMZN MKTP CA|AMAZON\.CA)\*\w+/, '$1')
  s = s.replace(/(CIBC MC|TD VISA|SCOTIALINE|CRA\d{4}RTN)\s+\w+$/, '$1')
  s = s.replace(/#\s*\d+/g, '')
  s = s.replace(/\*{3}(?=[A-Za-z0-9]{3}\b)\w+/g, '')
  s = s.replace(/^[A-Z]{2}\d{3} /, '')
  s = s.replace(/CHQ#\S+/, 'CHQ')
  s = s.replace(/(?<!\*)\b\d[\d-]*\b/g, '')
  return collapse(s)
}

/** The counter-account of a transfer line, and which way the money went. */
export function counterAccount(description: string): { direction: 'TO' | 'FR'; number: string } | undefined {
  const upper = collapse(description).toUpperCase()
  const transfer = /\bTFR-(TO|FR) (\S+)/.exec(upper)
  if (transfer) return { direction: transfer[1] as 'TO' | 'FR', number: transfer[2]! }
  const points = /^PTS (TO|FRM):\s*(\d+)/.exec(upper)
  if (points) return { direction: points[1] === 'TO' ? 'TO' : 'FR', number: points[2]! }
  return undefined
}

/** A readable merchant name when history offers none: `GABE'S NO FRILLS` → `Gabe's No Frills`. */
export function displayName(description: string): string {
  const key = statementKey(description) || collapse(description)
  return key
    .toLowerCase()
    .replace(/(^|[\s/&(-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
}
