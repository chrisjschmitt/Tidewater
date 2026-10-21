/**
 * A small calculator for amount fields, so a split part can be typed the way
 * it appears on a receipt: `=9.95+13%` (price plus HST) or `=9.95+5.95+1.95`
 * (three items). Numbers, + − × ÷ (also * / x), brackets, and %. Like a
 * pocket calculator, `a + b%` and `a − b%` add or take off b percent of a;
 * elsewhere `b%` is b ÷ 100. Parsed by hand — nothing is ever evaluated as
 * code. Returns null for anything it cannot read.
 */
export function evaluateAmount(input: string): number | null {
  const text = input.trim().replace(/^=/, '').replace(/[\s,$]/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  if (!text) return null
  let pos = 0
  const peek = () => text[pos]

  // A term's value and whether it was written as a percentage.
  type Value = { value: number; percent: boolean }

  const number = (): Value | null => {
    const match = /^\d*\.?\d+|^\d+\./.exec(text.slice(pos))
    if (!match) return null
    pos += match[0].length
    return { value: Number(match[0]), percent: false }
  }

  const primary = (): Value | null => {
    if (peek() === '-') {
      pos++
      const inner = primary()
      return inner ? { value: -inner.value, percent: inner.percent } : null
    }
    let result: Value | null
    if (peek() === '(') {
      pos++
      const inner = sum()
      if (!inner || peek() !== ')') return null
      pos++
      result = { value: inner, percent: false }
    } else {
      result = number()
    }
    if (result && peek() === '%') {
      pos++
      result = { value: result.value, percent: true }
    }
    return result
  }

  const product = (): Value | null => {
    let left: Value | null = primary()
    if (!left) return null
    while (peek() === '*' || peek() === '/') {
      const op = text[pos++]
      const right = primary()
      if (!right) return null
      const r: number = right.percent ? right.value / 100 : right.value
      const l: number = left.percent ? left.value / 100 : left.value
      if (op === '/' && r === 0) return null
      left = { value: op === '*' ? l * r : l / r, percent: false }
    }
    return left
  }

  function sum(): number | null {
    const first = product()
    if (!first) return null
    let total = first.percent ? first.value / 100 : first.value
    while (peek() === '+' || peek() === '-') {
      const op = text[pos++]
      const right = product()
      if (!right) return null
      // Calculator percent: 9.95 + 13% is 9.95 plus 13% of 9.95.
      const amount = right.percent ? (total * right.value) / 100 : right.value
      total = op === '+' ? total + amount : total - amount
    }
    return total
  }

  const result = sum()
  if (result === null || pos !== text.length || !Number.isFinite(result)) return null
  return Math.round(result * 100) / 100
}
