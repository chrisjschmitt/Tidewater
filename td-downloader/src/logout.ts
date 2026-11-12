import { QUIT_COMMAND, type ChromeEnd } from './bank-chrome.js'
import type { Page } from 'playwright'

import { checkSession } from './session-guard.js'

/**
 * Logs out of EasyWeb once a run has finished, so the debugging-port Chrome
 * is not left holding a live banking session that TD may not time out.
 *
 * One ordinary click on EasyWeb's own Log out control (and its "are you sure"
 * button, if it asks) — nothing else. If the control can't be found, or the
 * page never shows that the session ended, it says so and the person logs
 * out by hand. It never signs in: the downloader still has no code path for
 * credentials.
 */

export type LogoutResult = { loggedOut: true } | { loggedOut: false; why: string }

/** EasyWeb's wording for the control: "Logout", "Log out", "Sign out", "Log off". */
const NAME = /^\s*(log\s?out|sign\s?out|log\s?off)\s*$/i
/** A page that has ended the session says so in its address. */
const ENDED_URL = /log\s?out|sign\s?out|log\s?off|logged-?out/i

async function firstVisible(page: Page, scope: string): Promise<ReturnType<Page['locator']> | null> {
  const root = page.locator(scope)
  const candidates = root.getByRole('button', { name: NAME }).or(root.getByRole('link', { name: NAME }))
  const count = await candidates.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i)
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function sessionEnded(page: Page): Promise<boolean> {
  if (ENDED_URL.test(page.url())) return true
  // A login form or "you have been logged out" is what the guard looks for.
  return (await checkSession(page)).blocked
}

/**
 * EasyWeb closes the tab as it logs out, so whether it worked is checked in a
 * fresh tab: the home page either shows the login (logged out) or the
 * accounts (still in). The tab is closed again either way.
 */
async function confirmInFreshTab(page: Page, homeUrl: string): Promise<LogoutResult> {
  const probe = await page.context().newPage()
  try {
    await probe.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await probe.waitForTimeout(2000)
    return (await sessionEnded(probe))
      ? { loggedOut: true }
      : { loggedOut: false, why: 'EasyWeb closed the tab, but the home page still looks logged in' }
  } finally {
    await probe.close().catch(() => undefined)
  }
}

export async function logOut(page: Page, homeUrl: string): Promise<LogoutResult> {
  let clicked = false
  try {
    if (await sessionEnded(page)) return { loggedOut: true }
    let control = await firstVisible(page, 'body')
    if (!control) {
      // The run can end on a page without the control, such as a card whose
      // export TD cancelled, so look again from the home page.
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(2000)
      if (await sessionEnded(page)) return { loggedOut: true }
      control = await firstVisible(page, 'body')
    }
    if (!control) return { loggedOut: false, why: "couldn't find EasyWeb's Log out button" }

    // A native "Are you sure?" box is accepted; it is the person's own request.
    page.once('dialog', (dialog) => void dialog.accept().catch(() => undefined))
    await control.click({ timeout: 10_000 })
    clicked = true

    // Up to ~15 s for EasyWeb to end the session, confirming once if it asks.
    let confirmed = false
    for (let attempt = 0; attempt < 15; attempt++) {
      if (page.isClosed()) return await confirmInFreshTab(page, homeUrl)
      await page.waitForTimeout(1000)
      if (page.isClosed()) return await confirmInFreshTab(page, homeUrl)
      if (await sessionEnded(page)) return { loggedOut: true }
      if (!confirmed) {
        const confirm = await firstVisible(page, '[role=dialog], [role=alertdialog]')
        if (confirm) {
          confirmed = true
          await confirm.click({ timeout: 10_000 }).catch(() => undefined)
        }
      }
    }
    return { loggedOut: false, why: "clicked Log out, but EasyWeb didn't show that the session ended" }
  } catch (error) {
    // The tab closing under a wait is EasyWeb logging out, not a failure.
    if (clicked && page.isClosed()) return confirmInFreshTab(page, homeUrl).catch(() => ({ loggedOut: false as const, why: "couldn't check" }))
    return { loggedOut: false, why: error instanceof Error ? (error.message.split('\n')[0] ?? 'error') : String(error) }
  }
}

/** One line for the end of a run. */
export function describeLogout(result: LogoutResult | undefined, stayed: boolean, chrome?: ChromeEnd): string {
  if (stayed) return 'Still logged in to EasyWeb (--stay-signed-in). Log out and quit that Chrome when you are done.'
  if (!result) return 'Log out of EasyWeb and quit that Chrome (⌘Q) when you are done.'
  if (!result.loggedOut) return `Couldn't log out of EasyWeb (${result.why}). Log out by hand and quit that Chrome (⌘Q).`
  if (chrome === 'closed') return 'Logged out of EasyWeb and closed the bank Chrome window.'
  if (chrome === 'reclosed') {
    return 'Logged out of EasyWeb and closed the bank Chrome window. Chrome started itself again in the background, so it was closed a second time.'
  }
  if (chrome === 'open') {
    return [
      'Logged out of EasyWeb, but the bank Chrome is still running (maybe with no window), with its debugging port open.',
      `Quit it with:  ${QUIT_COMMAND}`,
    ].join('\n')
  }
  return 'Logged out of EasyWeb. Quit that Chrome window (⌘Q).'
}

export const STAY_FLAG = '--stay-signed-in'
