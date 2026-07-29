import { useEffect, useRef, useState } from 'react'
import { EXAMPLE_QUESTIONS, answer } from '../lib/assistant'
import {
  RECOMMENDED_MODELS,
  listModels,
  type ModelOption,
  type ModelRecommendation,
} from '../lib/models'
import {
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  activeConfig,
  clearChat,
  loadChat,
  saveChat,
  updateProviderConfig,
  type ChatMessage,
  type CloudProvider,
  type Provider,
  type ProviderConfig,
  type Settings,
} from '../lib/storage'
import type { Budget } from '../lib/types'

interface Props {
  open: boolean
  onClose: () => void
  budget: Budget
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}

/** Say plainly where answers are coming from right now, not where they could. */
function statusLine(settings: Settings): string {
  const config = activeConfig(settings)
  if (!config) return 'Answered on this device, from your own numbers'
  if (!config.apiKey) return 'Add a key in Settings, or keep using on-device answers'
  if (!settings.cloudAcknowledged) return 'Confirm in Settings before your budget is sent anywhere'
  return `Using ${settings.provider} · ${config.model}`
}

export default function ChatPanel({ open, onClose, budget, settings, onSettingsChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void loadChat().then((saved) => {
      if (saved.length > 0) setMessages(saved)
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void saveChat(messages)
  }, [messages, hydrated])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  // The panel stays mounted so it can slide, so keep it out of the tab order
  // and the accessibility tree while it is off screen.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (open) el.removeAttribute('inert')
    else el.setAttribute('inert', '')
  }, [open])

  const send = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    setInput('')
    setMessages((m) => [...m, { id: Date.now(), role: 'user', text }])
    setBusy(true)
    try {
      const result = await answer(text, budget, settings)
      setMessages((m) => [
        ...m,
        { id: Date.now() + 1, role: 'assistant', text: result.text, cloud: result.usedCloud },
      ])
    } finally {
      setBusy(false)
    }
  }

  const eraseChat = () => {
    setMessages([])
    void clearChat()
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-ink-900/10 animate-fade" onClick={onClose} />}

      <aside
        ref={panelRef}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-sand-200 bg-sand-50 shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-sand-200 bg-white/60 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Ask about your money</h2>
            <p className="text-xs text-ink-400">{statusLine(settings)}</p>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={eraseChat}
                className="btn-quiet px-2 py-1 text-xs"
                aria-label="Clear chat history"
                title="Clear chat"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="btn-quiet px-2 py-1 text-xs"
              aria-label="Assistant settings"
            >
              Settings
            </button>
            <button onClick={onClose} aria-label="Close chat" className="btn-quiet px-2 py-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        {showSettings && (
          <AssistantSettings settings={settings} onChange={onSettingsChange} />
        )}

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 && (
            <div className="animate-fade">
              <p className="text-sm text-ink-500">
                Ask anything about your plan. Nothing here is a judgement — it is just your own
                numbers, read back to you.
              </p>
              <div className="mt-4 space-y-2">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="w-full rounded-2xl border border-sand-200 bg-white/70 px-4 py-2.5 text-left text-sm text-ink-700 transition hover:border-tide-300 hover:bg-tide-50/50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`animate-rise ${m.role === 'user' ? 'flex justify-end' : ''}`}
            >
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] rounded-2xl rounded-br-md bg-tide-600 px-4 py-2.5 text-sm text-white'
                    : 'max-w-full rounded-2xl rounded-bl-md bg-white/80 px-4 py-3 text-sm leading-relaxed text-ink-700'
                }
              >
                {m.text.split('\n').map((line, i) =>
                  line.trim() === '' ? (
                    <div key={i} className="h-2" />
                  ) : (
                    <p key={i}>{line}</p>
                  ),
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex gap-1.5 px-2 text-ink-400">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
          className="border-t border-sand-200 bg-white/60 px-5 py-4"
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="field flex-1"
            />
            <button type="submit" disabled={!input.trim() || busy} className="btn-primary">
              Ask
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}

/** Keep the everyday choice small; the provider's full catalog is advanced. */
function ModelPicker({
  provider,
  config,
  onSelect,
}: {
  provider: CloudProvider
  config: ProviderConfig
  onSelect: (model: string) => void
}) {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [showOther, setShowOther] = useState(false)
  const recommendations = RECOMMENDED_MODELS[provider] ?? []

  // A model list belongs to one key, so drop it when either changes.
  useEffect(() => {
    setOptions([])
    setState('idle')
    setError('')
    setShowOther(false)
  }, [provider, config.apiKey])

  const load = async () => {
    setState('loading')
    setError('')
    try {
      const models = await listModels(provider, config.apiKey)
      setOptions(models)
      setState('done')
      if (
        recommendations.length === 0 &&
        models.length > 0 &&
        !models.some((m) => m.id === config.model)
      ) {
        onSelect(models[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  return (
    <div>
      <label className="label">Model</label>

      {recommendations.length > 0 ? (
        <div className="mt-1.5 space-y-2">
          {recommendations.map((model) => (
            <RecommendedModel
              key={model.id}
              model={model}
              selected={sameModelFamily(config.model, model.id)}
              onSelect={() => onSelect(model.id)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-1.5">
          <ModelSelect
            options={options}
            value={config.model}
            placeholder={DEFAULT_MODELS[provider]}
            onSelect={onSelect}
          />
          <button
            onClick={() => void load()}
            disabled={!config.apiKey || state === 'loading'}
            className="mt-1.5 text-[11px] text-tide-700 underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline"
          >
            {state === 'loading' ? 'Loading…' : 'Load available models'}
          </button>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => {
              const opening = !showOther
              setShowOther(opening)
              if (opening && options.length === 0 && config.apiKey) void load()
            }}
            className="text-[11px] text-ink-500 underline hover:text-ink-900"
          >
            {showOther ? 'Hide other models' : 'Other models'}
          </button>

          {showOther && (
            <div className="mt-2 animate-fade">
              <ModelSelect
                options={options}
                value={config.model}
                placeholder={DEFAULT_MODELS[provider]}
                onSelect={onSelect}
              />
              {state === 'loading' && (
                <p className="mt-1.5 text-[11px] text-ink-400">Loading models available to your key…</p>
              )}
              {state === 'done' && (
                <p className="mt-1.5 text-[11px] text-ink-400">
                  {options.length} models available. The models above are the sensible choices for Tidewater.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {state === 'error' && <p className="mt-1.5 text-[11px] text-shell-500">{error}</p>}
      {state === 'idle' && recommendations.length === 0 && (
        <p className="mt-1.5 text-[11px] text-ink-400">
          Model ids change over time. If you get a “not found” error, load the list and pick one.
        </p>
      )}
    </div>
  )
}

function RecommendedModel({
  model,
  selected,
  onSelect,
}: {
  model: ModelRecommendation
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border px-3.5 py-3 text-left transition ${
        selected
          ? 'border-tide-500 bg-tide-50 ring-1 ring-tide-500/20'
          : 'border-sand-200 bg-white/70 hover:border-tide-300'
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-ink-900">
          {model.name}
          {model.recommended && (
            <span className="ml-2 rounded-full bg-tide-100 px-2 py-0.5 text-[10px] font-medium text-tide-700">
              Recommended
            </span>
          )}
        </span>
        <span className="shrink-0 text-[11px] font-semibold text-ink-500">
          {model.cost} · {model.costLabel}
        </span>
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-ink-500">
        {model.description}
      </span>
    </button>
  )
}

function ModelSelect({
  options,
  value,
  placeholder,
  onSelect,
}: {
  options: ModelOption[]
  value: string
  placeholder: string
  onSelect: (model: string) => void
}) {
  if (options.length === 0) {
    return (
      <input
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        placeholder={placeholder}
        className="field"
      />
    )
  }

  return (
    <select value={value} onChange={(e) => onSelect(e.target.value)} className="field">
      {!options.some((m) => m.id === value) && <option value={value}>{value}</option>}
      {options.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  )
}

function sameModelFamily(current: string, recommendation: string): boolean {
  return current === recommendation || current.startsWith(`${recommendation}-20`)
}

function AssistantSettings({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const provider = settings.provider
  const config = activeConfig(settings)

  return (
    <div className="border-b border-sand-200 bg-white/70 px-5 py-4 text-sm animate-fade">
      <label className="label">Answered by</label>
      <select
        value={provider}
        onChange={(e) => onChange({ ...settings, provider: e.target.value as Provider })}
        className="field mt-1.5"
      >
        {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
          <option key={p} value={p}>
            {PROVIDER_LABELS[p]}
          </option>
        ))}
      </select>

      {provider !== 'local' && config && (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl border border-shell-300/60 bg-shell-300/10 px-4 py-3 text-xs text-ink-700">
            A summary of your budget — income, spending by category, and goals — will be sent to{' '}
            {provider}. Your key is stored only on this device and is never sent anywhere else.
          </div>

          <div>
            <label className="label">
              {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) =>
                onChange(updateProviderConfig(settings, provider, { apiKey: e.target.value }))
              }
              placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              className="field mt-1.5"
              autoComplete="off"
            />
          </div>

          <ModelPicker
            provider={provider}
            config={config}
            onSelect={(model) => onChange(updateProviderConfig(settings, provider, { model }))}
          />

          <label className="mt-1 flex items-start gap-2.5 text-xs text-ink-700">
            <input
              type="checkbox"
              checked={settings.cloudAcknowledged}
              onChange={(e) => onChange({ ...settings, cloudAcknowledged: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-sand-300 text-tide-600 focus:ring-tide-500/30"
            />
            I understand my budget summary will leave this device when I ask a question.
          </label>
        </div>
      )}
    </div>
  )
}
