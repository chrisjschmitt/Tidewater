import { del, get, set } from 'idb-keyval'
import type { Budget } from './types'

const BUDGET_KEY = 'tidewater.budget'
const SETTINGS_KEY = 'tidewater.settings'

export type CloudProvider = 'openai' | 'anthropic'
export type Provider = 'local' | CloudProvider

export interface ProviderConfig {
  /** Stored on this device only, and only for the provider it belongs to. */
  apiKey: string
  model: string
}

export interface Settings {
  provider: Provider
  /** Keys and models are kept per provider so switching never sends the wrong key. */
  providers: Record<CloudProvider, ProviderConfig>
  /** The user has seen and accepted the "this leaves your device" warning. */
  cloudAcknowledged: boolean
}

/**
 * Starting points only. Model ids are retired regularly, so the settings panel
 * can load the real list from the provider — trust that over these.
 */
export const DEFAULT_MODELS: Record<CloudProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  local: 'This device only (private, no network)',
  openai: 'OpenAI (your own key)',
  anthropic: 'Anthropic (your own key)',
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'local',
  providers: {
    openai: { apiKey: '', model: DEFAULT_MODELS.openai },
    anthropic: { apiKey: '', model: DEFAULT_MODELS.anthropic },
  },
  cloudAcknowledged: false,
}

export const activeConfig = (s: Settings): ProviderConfig | null =>
  s.provider === 'local' ? null : s.providers[s.provider]

export function updateProviderConfig(
  s: Settings,
  provider: CloudProvider,
  patch: Partial<ProviderConfig>,
): Settings {
  return {
    ...s,
    providers: { ...s.providers, [provider]: { ...s.providers[provider], ...patch } },
  }
}

export async function loadBudget(): Promise<Budget | undefined> {
  try {
    return await get<Budget>(BUDGET_KEY)
  } catch {
    return undefined
  }
}

export async function saveBudget(budget: Budget): Promise<void> {
  await set(BUDGET_KEY, budget)
}

export async function clearBudget(): Promise<void> {
  await del(BUDGET_KEY)
}

const RETIRED_MODELS = [/^claude-2/, /^claude-instant/, /^claude-3(?!-7)/, /^gpt-3\.5/]

const isRetiredModel = (model: string) => RETIRED_MODELS.some((r) => r.test(model))

/** Settings saved before keys were kept per provider. */
interface LegacySettings {
  provider?: Provider
  apiKey?: string
  model?: string
  cloudAcknowledged?: boolean
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await get<Settings & LegacySettings>(SETTINGS_KEY)
    if (!stored) return DEFAULT_SETTINGS

    let settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      providers: { ...DEFAULT_SETTINGS.providers, ...(stored.providers ?? {}) },
    }

    // Move a single shared key onto whichever provider it was being used with.
    if (!stored.providers && stored.apiKey && stored.provider && stored.provider !== 'local') {
      settings = updateProviderConfig(settings, stored.provider, {
        apiKey: stored.apiKey,
        model: stored.model || DEFAULT_MODELS[stored.provider],
      })
    }

    // Replace model ids the provider has since retired, which otherwise fail
    // with a confusing 404 on the first question.
    for (const provider of ['openai', 'anthropic'] as CloudProvider[]) {
      if (isRetiredModel(settings.providers[provider].model)) {
        settings = updateProviderConfig(settings, provider, { model: DEFAULT_MODELS[provider] })
      }
    }

    // Write migrations back so the old shape is not re-read on every launch.
    if (JSON.stringify(settings) !== JSON.stringify(stored)) await saveSettings(settings)
    return settings
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await set(SETTINGS_KEY, settings)
}

export function downloadFile(filename: string, contents: string, mime = 'text/csv') {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
