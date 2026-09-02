import { useState, type ReactNode } from 'react'
import Modal from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  onOpenChat?: () => void
}

interface Topic {
  id: string
  title: string
  category: string
  summary: string
  content: ReactNode
}

const TOPICS: Topic[] = [
  {
    id: 'getting-started',
    title: 'How Tidewater works & mindset',
    category: 'Overview',
    summary: 'Focus on abundance, see where money goes, and direct surplus toward goals without scarcity or shame.',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Tidewater shifts personal budgeting away from restriction and guilt. It gives you a clear visual dashboard
          of what you earn and spend, encouraging an abundance mindset.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-700">
          <li>
            <strong>Summary Ring:</strong> Highlights monthly income, total planned spending, and active goal contributions.
          </li>
          <li>
            <strong>Unallocated Funds:</strong> Money left over after expenses and goals is displayed clearly so you can point it toward new opportunities.
          </li>
          <li>
            <strong>No Preachiness:</strong> Budgeting is about designing your life, not feeling restricted by rigid limits.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'expenses',
    title: 'Adjusting expenses & groups',
    category: 'Budgeting',
    summary: 'Click any expense group bar to fine-tune subgroups using interactive sliders or direct dollar amounts.',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Expenses are grouped into broad categories (like <em>Home & Shelter</em> or <em>Food & Groceries</em>) and ordered by total spend from largest to smallest.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-700">
          <li>
            <strong>Group Details:</strong> Click or tap any expense bar to open a detailed breakdown of all subgroups within that category.
          </li>
          <li>
            <strong>Sliders & Inputs:</strong> Move sliders to quickly balance amounts or click into numbers to type exact dollar values.
          </li>
          <li>
            <strong>Real-time Totals:</strong> All changes automatically recalculate your total spending and remaining funds on the dashboard.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'goals',
    title: 'Setting savings & debt goals',
    category: 'Goals',
    summary: 'Direct surplus funds toward RRSP, house down payment, emergency savings, or debt payoff with compound growth tracking.',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Goals help you direct your surplus money toward long-term aspirations or clearing debts.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-700">
          <li>
            <strong>Add Custom Goals:</strong> Use predefined templates or click <em>Something else</em> to create your own custom goal.
          </li>
          <li>
            <strong>Compound Growth:</strong> Set an expected interest rate to visualize how monthly contributions grow over 1, 5, 10, 25, or 35 years.
          </li>
          <li>
            <strong>Target Milestones:</strong> Track your progress toward a total target amount and date.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'import-export',
    title: 'Importing & data backups',
    category: 'Data & CSV',
    summary: 'Import Monarch Money transaction CSVs, load spreadsheet budgets, and download JSON backups anytime.',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Tidewater makes it easy to bring in existing financial data or export your budget for safekeeping.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-700">
          <li>
            <strong>Monarch Money Import:</strong> Import 12 months of exported transactions (<code>Transactions_...csv</code>).
            Tidewater shows a progress bar while it reads and averages the file, then filters out internal transfers/payments.
          </li>
          <li>
            <strong>Budget CSV:</strong> Load or export clean CSV budget files compatible with Excel or Google Sheets.
          </li>
          <li>
            <strong>JSON Backup:</strong> Under <strong>Your data</strong>, download a full snapshot
            (budget, goals, profile
            {__ETM_AVAILABLE__
              ? ', and the encrypted expenses vault if you have set that up — the key is not in the file'
              : ''}
            ), then restore it with <strong>Restore a full backup</strong> — or use the header{' '}
            <strong>Import</strong> button with a <code>.json</code> file.
            {__ETM_AVAILABLE__
              ? ' On another device, unlock expense tracking with the same key.'
              : ''}
          </li>
          <li>
            <strong>Ted’s Sample Budget:</strong> Explore pre-populated sample data anytime to test features safely.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'assistant',
    title: 'Using the chat assistant',
    category: 'Assistant',
    summary: __ETM_AVAILABLE__
      ? 'Ask about your typical-month plan, how to use Tidewater, and while expense tracking is unlocked, about actuals and forecast patterns — never the ledger.'
      : 'Ask about your typical-month plan or how to use Tidewater, using the local or optional cloud assistant.',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Click <strong>Ask a question</strong> in the header or floating button at the bottom-right to open the assistant.
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-700">
          <li>
            <strong>On this device:</strong> Instant answers from your typical-month plan — groups,
            goals, and unallocated funds — and how to use the dashboard, Import, and Your data,
            without sending data anywhere.
          </li>
          {__ETM_AVAILABLE__ && (
            <li>
              <strong>While expense tracking is unlocked:</strong> The same panel can also see a
              compact snapshot of actuals and Forecast patterns (totals and classifications). It
              never sees individual transactions, merchants, or the vault. Ask “what did I spend”
              versus “what is the typical-month plan” to keep those series distinct. Ask “how do I
              use the Forecast tab” for a walkthrough rather than the figures.
            </li>
          )}
          <li>
            <strong>Optional cloud:</strong> Enter your own OpenAI or Anthropic API key in Assistant
            Settings for deeper conversational guidance. A compact summary of the plan
            {__ETM_AVAILABLE__ ? ' — and, if unlocked, of spending/forecast totals —' : ''} may
            leave the device after you acknowledge that. Keys stay here. The vault never leaves.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy & on-device storage',
    category: 'Privacy',
    summary: 'Your financial data is 100% private and stored exclusively in your browser’s IndexedDB storage.',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Tidewater is built with strict privacy invariants:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-ink-700">
          <li>
            <strong>No Cloud Server:</strong> There are no user accounts, logins, or remote databases.
          </li>
          <li>
            <strong>No Analytics:</strong> No tracking scripts, analytics tools, or third-party metrics.
          </li>
          <li>
            <strong>Local Storage:</strong> All budget data, history, and settings remain solely on your device.
          </li>
        </ul>
      </div>
    ),
  },
]

export default function HelpModal({ open, onClose, onOpenChat }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>('getting-started')
  const [query, setQuery] = useState('')

  const filtered = TOPICS.filter((t) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      t.title.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q)
    )
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Help & Guide"
      subtitle="Everything you need to know about using Tidewater."
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-4">
          {onOpenChat ? (
            <button onClick={onOpenChat} className="btn-quiet text-xs">
              Have a question? Ask the assistant
            </button>
          ) : (
            <div />
          )}
          <button onClick={onClose} className="btn-primary text-xs">
            Got it
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help topics..."
            className="field py-2 pl-9 text-xs"
          />
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-400">No matching help topics found.</p>
          ) : (
            filtered.map((topic) => {
              const isExpanded = expandedId === topic.id
              return (
                <div
                  key={topic.id}
                  className="rounded-2xl border border-sand-200 bg-white/70 overflow-hidden transition"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : topic.id)}
                    className="flex w-full items-start justify-between gap-4 p-4 text-left hover:bg-sand-50/50 transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-sand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-tide-700">
                          {topic.category}
                        </span>
                        <h3 className="text-sm font-semibold text-ink-900">{topic.title}</h3>
                      </div>
                      <p className="text-xs text-ink-500 leading-relaxed">{topic.summary}</p>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className={`shrink-0 text-ink-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-sand-200/60 bg-sand-50/40 p-4 animate-fade">
                      {topic.content}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </Modal>
  )
}
