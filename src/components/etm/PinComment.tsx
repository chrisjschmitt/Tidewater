import { useEffect, useState } from 'react'

export function PinComment({
  value,
  onChange,
  onCommit,
}: {
  value: string
  onChange: (value: string) => void
  onCommit?: (value: string) => void
}) {
  return (
    <input
      className="field w-full py-1.5 text-sm"
      aria-label="Why this is on this month"
      placeholder="Why this is on this month"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => onCommit?.(value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.currentTarget.blur()
      }}
    />
  )
}

export function SavedPinComment({
  notes,
  onSave,
}: {
  notes: string
  onSave: (notes: string) => void
}) {
  const [value, setValue] = useState(notes)
  useEffect(() => {
    setValue(notes)
  }, [notes])

  return (
    <PinComment
      value={value}
      onChange={setValue}
      onCommit={(next) => {
        const trimmed = next.trim()
        if (trimmed === notes.trim()) return
        onSave(trimmed)
      }}
    />
  )
}
