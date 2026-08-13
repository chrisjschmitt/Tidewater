import { useRef, useState } from 'react'
import { parseStatementCsv, StatementFormatError } from '../../lib/etm/statement'
import { uid } from '../../lib/format'
import type { Account, BalanceSnapshot } from '../../lib/etm/types'

interface Props {
  account: Account
  /** The month being settled; the balance defaults to its last day. */
  month: string
  existing?: BalanceSnapshot
  onSave: (snapshot: BalanceSnapshot) => void
  onClose: () => void
}

/**
 * One balance, typed in or read off a statement. A statement is only ever
 * read for its closing figure (§9) — the rows inside it are not imported,
 * because Monarch is the one source of transactions.
 */
export default function BalanceForm({ account, month, existing, onSave, onClose }: Props) {
  const lastDay = endOf(month)
  const [date, setDate] = useState(existing?.date ?? lastDay)
  const [balance, setBalance] = useState(existing ? String(existing.balance) : '')
  const [pending, setPending] = useState(existing?.pending ? String(existing.pending) : '')
  const [source, setSource] = useState<BalanceSnapshot['source']>(existing?.source ?? 'manual')
  const [fileName, setFileName] = useState(existing?.fileName ?? '')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const isCard = account.kind === 'credit'

  async function readStatement(file: File) {
    setError('')
    try {
      const reading = parseStatementCsv(await file.text())
      setDate(reading.date)
      setBalance(String(reading.balance))
      setSource('statement')
      setFileName(file.name)
    } catch (err) {
      setError(
        err instanceof StatementFormatError
          ? err.message
          : 'That file could not be read as a statement.',
      )
      setSource('manual')
    }
  }

  function submit() {
    const amount = Number(balance.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(amount) || balance.trim() === '') {
      setError('Please enter the balance as a number.')
      return
    }
    const pendingAmount = Number(pending.replace(/[^0-9.-]/g, ''))
    onSave({
      id: existing?.id ?? uid('bal'),
      accountId: account.id,
      date,
      balance: amount,
      ...(isCard && Number.isFinite(pendingAmount) && pending.trim() !== ''
        ? { pending: Math.abs(pendingAmount) }
        : {}),
      source,
      ...(fileName ? { fileName } : {}),
    })
    onClose()
  }

  return (
    <div className="space-y-3 rounded-2xl bg-white/70 px-4 py-4">
      <p className="text-sm font-medium text-ink-900">
        {existing ? 'Update' : 'Record'} the balance of {account.nickname}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">As of</span>
          <input
            type="date"
            className="field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">
            {isCard ? `Owed (${account.currency})` : `Balance (${account.currency})`}
          </span>
          <input
            className="field"
            inputMode="decimal"
            placeholder="0.00"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </label>
        {isCard && (
          <label className="block">
            <span className="label">Charged, not yet posted</span>
            <input
              className="field"
              inputMode="decimal"
              placeholder="0.00"
              value={pending}
              onChange={(e) => setPending(e.target.value)}
            />
          </label>
        )}
      </div>

      {isCard && (
        <p className="text-xs text-ink-400">
          Enter what is owed as a positive number. Pending charges appear in no
          export, so they can only be typed in — and a card is not really
          cleared until they land.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void readStatement(file)
            e.target.value = ''
          }}
        />
        <button onClick={() => fileRef.current?.click()} className="btn-ghost text-xs">
          Read from a statement CSV
        </button>
        {source === 'statement' && fileName && (
          <span className="text-xs text-ink-400">from {fileName}</span>
        )}
      </div>

      {error && <p className="text-xs text-shell-500">{error}</p>}

      <div className="flex gap-2">
        <button onClick={submit} className="btn-primary text-xs">
          Save balance
        </button>
        <button onClick={onClose} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}

function endOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}
