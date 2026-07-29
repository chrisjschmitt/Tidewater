import type { CloudProvider } from './storage'

export interface ModelOption {
  id: string
  label: string
}

export interface ModelRecommendation {
  id: string
  name: string
  cost: '$' | '$$'
  costLabel: string
  description: string
  recommended?: boolean
}

/**
 * Deliberately short. Tidewater questions do not need Anthropic's most
 * expensive agentic models. Prices are relative so this guidance does not
 * pretend to be a billing calculator.
 */
export const RECOMMENDED_MODELS: Partial<Record<CloudProvider, ModelRecommendation[]>> = {
  anthropic: [
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      cost: '$',
      costLabel: 'Lowest cost',
      description: 'Fast and capable — best for everyday budget questions.',
      recommended: true,
    },
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      cost: '$$',
      costLabel: 'More expensive',
      description: 'Stronger reasoning for detailed trade-offs and financial plans.',
    },
  ],
}

/** Model families that cannot answer a chat question. */
const NOT_CHAT = [
  'embedding',
  'whisper',
  'tts',
  'dall-e',
  'moderation',
  'audio',
  'realtime',
  'transcribe',
  'image',
  'search',
  'codex',
  'davinci',
  'babbage',
]

/**
 * Ask the provider which models the key can actually use. Hardcoded model lists
 * go stale and produce confusing 404s, and only the provider knows what a
 * particular account is entitled to.
 */
export async function listModels(
  provider: CloudProvider,
  apiKey: string,
): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('Add your API key first.')

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (!res.ok) throw new Error(await describeFailure(res))
    const data = await res.json()
    return (data.data ?? []).map((m: { id: string; display_name?: string }) => ({
      id: m.id,
      label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
    }))
  }

  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(await describeFailure(res))
  const data = await res.json()
  return (data.data ?? [])
    .map((m: { id: string }) => m.id)
    .filter((id: string) => !NOT_CHAT.some((t) => id.includes(t)))
    .sort((a: string, z: string) => z.localeCompare(a))
    .map((id: string) => ({ id, label: id }))
}

async function describeFailure(res: Response): Promise<string> {
  const body = await res.text()
  if (res.status === 401) return 'That key was rejected (401). Check it and try again.'
  if (res.status === 403) return 'That key is not permitted to list models (403).'
  return `The provider returned ${res.status}. ${body.slice(0, 200)}`
}
