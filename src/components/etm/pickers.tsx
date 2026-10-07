import { useState } from 'react'

/**
 * Choosing from what already exists, quickly. A category is one pick from a
 * list; tags are chips with a remove button and a list to add from. Either can
 * take a new name when nothing fits.
 */

const NEW = '\u0000new'

export function CategorySelect({
  value,
  options,
  onChange,
  className = 'field w-56 py-1 text-sm',
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  className?: string
}) {
  const [typing, setTyping] = useState(false)
  const known = value === '' || options.includes(value)

  if (typing || !known) {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus={typing}
          className={className}
          placeholder="New category"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="text-xs text-ink-400 hover:text-ink-900"
          onClick={() => {
            setTyping(false)
            onChange('')
          }}
          title="Choose from the list instead"
        >
          List
        </button>
      </span>
    )
  }

  return (
    <select
      className={className}
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setTyping(true)
          onChange('')
        } else onChange(e.target.value)
      }}
    >
      <option value="">Category…</option>
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      <option value={NEW}>New category…</option>
    </select>
  )
}

export function TagPicker({
  value,
  options,
  onChange,
}: {
  value: string[]
  options: string[]
  onChange: (value: string[]) => void
}) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const available = options.filter((tag) => !value.includes(tag))
  const add = (tag: string) => {
    const clean = tag.trim()
    if (clean && !value.includes(clean)) onChange([...value, clean])
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {value.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-ink-700 ring-1 ring-sand-200">
          {tag}
          <button
            type="button"
            className="text-ink-400 hover:text-shell-500"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      {typing ? (
        <input
          autoFocus
          className="field w-48 py-0.5 text-xs"
          placeholder="New tag, then Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
              setDraft('')
              setTyping(false)
            }
            if (e.key === 'Escape') setTyping(false)
          }}
          onBlur={() => {
            add(draft)
            setDraft('')
            setTyping(false)
          }}
        />
      ) : (
        <select
          className="field w-36 py-0.5 text-xs"
          value=""
          onChange={(e) => {
            if (e.target.value === NEW) setTyping(true)
            else add(e.target.value)
          }}
          aria-label="Add a tag"
        >
          <option value="">Add tag…</option>
          {available.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
          <option value={NEW}>New tag…</option>
        </select>
      )}
    </span>
  )
}
