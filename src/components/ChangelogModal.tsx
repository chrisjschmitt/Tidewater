import { type ReactNode } from 'react'
import changelog from '../../CHANGELOG.md?raw'
import Modal from './Modal'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Renders CHANGELOG.md without a markdown library. The file is the source of
 * truth; this only understands headings and bullets, which is all we write.
 */
export default function ChangelogModal({ open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What’s new"
      subtitle="Release notes for Tidewater."
      width="max-w-lg"
    >
      <div className="space-y-5 text-sm leading-relaxed text-ink-700">{renderChangelog(changelog)}</div>
    </Modal>
  )
}

function renderChangelog(source: string) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let list: string[] = []
  let key = 0

  const flushList = () => {
    if (list.length === 0) return
    nodes.push(
      <ul key={key++} className="mt-1.5 list-disc space-y-1 pl-5 text-ink-600">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) {
      flushList()
      continue // Modal already titles the dialog.
    }
    if (line.startsWith('## ')) {
      flushList()
      nodes.push(
        <h3 key={key++} className="pt-1 text-base font-semibold tracking-tight text-ink-900">
          {line.slice(3)}
        </h3>,
      )
      continue
    }
    if (line.startsWith('### ')) {
      flushList()
      nodes.push(
        <h4 key={key++} className="pt-2 text-xs font-semibold uppercase tracking-wider text-tide-700">
          {line.slice(4)}
        </h4>,
      )
      continue
    }
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      continue
    }
    flushList()
    if (line.trim() === '') continue
    nodes.push(
      <p key={key++} className="text-ink-500">
        {inline(line)}
      </p>,
    )
  }
  flushList()
  return nodes
}

/** Turn `**bold**` and `[label](url)` into elements. */
function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      parts.push(
        <strong key={i++} className="font-semibold text-ink-800">
          {token.slice(2, -2)}
        </strong>,
      )
    } else {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (m) {
        parts.push(
          <a
            key={i++}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="text-tide-700 underline underline-offset-2"
          >
            {m[1]}
          </a>,
        )
      }
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 ? parts[0] : parts
}
