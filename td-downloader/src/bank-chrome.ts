import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright'
import type { Browser } from 'playwright'

/**
 * Checks on the bank Chrome itself (0.5.1), beyond driving its pages:
 *
 * - **Extensions.** The bank profile should hold nothing but EasyWeb. An
 *   extension that can read pages can read the bank's pages, and signing the
 *   profile in to Google syncs every everyday extension into it (found
 *   2026-11-12: Tampermonkey, MetaMask, AdBlock and others).
 * - **Closed means closed.** On 2026-11-12 Chrome quit when asked, then started
 *   itself again 27 seconds later with no window and the debugging port open.
 *   "Closed" is now only reported once the port has stayed shut.
 */

/** Installed by Chrome itself on every profile; they only run on Google's own sites. */
const CHROME_DEFAULTS = new Set([
  'ghbmnnjooekpmoecnnnilnnbdlolhkhi', // Google Docs Offline
  'nmmhkkegccagdldgiimedpiccmgmieda', // Chrome Web Store Payments
])

const EXTENSION_ID = /^[a-p]{32}$/

/** The profile launch-chrome.sh starts Chrome with. */
export function bankProfileDir(): string {
  return process.env.TD_PROFILE_DIR ?? join(homedir(), '.td-downloader-profile')
}

/**
 * Extensions in the bank Chrome beyond Chrome's defaults, by name. Two sources:
 * the profile's Extensions folder, and any extension pages or workers running
 * in the Chrome the run attached to (in case it was started with another profile).
 */
export async function extraExtensions(browser: Browser | null, profileDir = bankProfileDir()): Promise<string[]> {
  const ids = new Set<string>()
  const names = new Map<string, string>()

  const folder = join(profileDir, 'Default', 'Extensions')
  for (const id of await readdir(folder).catch(() => [] as string[])) {
    if (!EXTENSION_ID.test(id) || CHROME_DEFAULTS.has(id)) continue
    ids.add(id)
    const name = await extensionName(join(folder, id))
    if (name) names.set(id, name)
  }

  if (browser) {
    try {
      const cdp = await browser.newBrowserCDPSession()
      const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { url: string }[] }
      for (const { url } of targetInfos) {
        const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1]
        if (id && !CHROME_DEFAULTS.has(id)) ids.add(id)
      }
      await cdp.detach().catch(() => undefined)
    } catch {
      // The folder check above still stands.
    }
  }

  return [...ids].map((id) => names.get(id) ?? id).sort((a, b) => a.localeCompare(b))
}

/** The name an extension shows in chrome://extensions, from its newest installed version. */
async function extensionName(dir: string): Promise<string | undefined> {
  try {
    const versions = (await readdir(dir)).sort()
    const latest = versions[versions.length - 1]
    if (!latest) return undefined
    const root = join(dir, latest)
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { name?: string; default_locale?: string }
    const raw = manifest.name
    const key = raw ? /^__MSG_(.+)__$/.exec(raw)?.[1] : undefined
    if (!raw || !key) return raw
    for (const locale of ['en', 'en_US', manifest.default_locale].filter(Boolean) as string[]) {
      try {
        const messages = JSON.parse(await readFile(join(root, '_locales', locale, 'messages.json'), 'utf8')) as Record<string, { message?: string }>
        const hit = Object.entries(messages).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]?.message
        if (hit) return hit
      } catch {
        // Try the next locale.
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export function describeExtensions(names: string[]): string {
  return [
    `⚠ The bank Chrome has ${names.length === 1 ? 'an extension' : `${names.length} extensions`} besides Chrome's own: ${names.join(', ')}.`,
    '  Extensions can read the bank pages. Remove them in chrome://extensions in the bank window,',
    "  and keep that profile signed out of Google, or they sync back in.",
  ].join('\n')
}

/** True while something answers on the debugging port. */
export async function portAnswers(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/json/version', cdpUrl), { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits up to `ms` for the port to stop answering. */
export async function waitForPortClosed(cdpUrl: string, ms: number, everyMs = 500): Promise<boolean> {
  const until = Date.now() + ms
  for (;;) {
    if (!(await portAnswers(cdpUrl))) return true
    if (Date.now() >= until) return false
    await sleep(everyMs)
  }
}

/** Watches a closed port for `ms`; true if it opened again. */
export async function portReopens(cdpUrl: string, ms: number, everyMs = 2_000): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    await sleep(everyMs)
    if (await portAnswers(cdpUrl)) return true
  }
  return false
}

/** Connects to whatever is on the port and asks it to quit. */
export async function closeOverCdp(cdpUrl: string): Promise<void> {
  try {
    const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5_000 })
    const cdp = await browser.newBrowserCDPSession()
    await cdp.send('Browser.close').catch(() => undefined)
  } catch {
    // Reported by the port check that follows.
  }
}

/**
 * How the bank Chrome ended up:
 * - `closed`: the port shut and stayed shut;
 * - `reclosed`: Chrome started itself again and was closed a second time;
 * - `open`: the port is still answering, so Chrome is running (maybe without a window).
 */
export type ChromeEnd = 'closed' | 'reclosed' | 'open'

/** Seconds the closed port is watched; this morning's restart came after 27. */
export const WATCH_MS = 45_000
const CLOSE_WAIT_MS = 10_000

/**
 * After Browser.close: confirms the port shut, then watches it in case Chrome
 * restarts itself, closing it once more if it does.
 */
export async function confirmClosed(cdpUrl: string, log: (message: string) => void, watchMs = WATCH_MS): Promise<ChromeEnd> {
  if (!(await waitForPortClosed(cdpUrl, CLOSE_WAIT_MS))) return 'open'
  log(`  Checking the bank Chrome stays closed (${Math.round(watchMs / 1000)}s)…`)
  if (!(await portReopens(cdpUrl, watchMs))) return 'closed'

  await closeOverCdp(cdpUrl)
  if (!(await waitForPortClosed(cdpUrl, CLOSE_WAIT_MS))) return 'open'
  // A second restart is reported as open: something keeps bringing it back.
  return (await portReopens(cdpUrl, watchMs)) ? 'open' : 'reclosed'
}

/** The command that quits only the bank Chrome, for when closing it didn't work. */
export const QUIT_COMMAND = 'pkill -f "user-data-dir=$HOME/.td-downloader-profile"'
