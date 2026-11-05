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

export async function logOut(page: Page): Promise<LogoutResult> {
  try {
    if (await sessionEnded(page)) return { loggedOut: true }
    const control = await firstVisible(page, 'body')
    if (!control) return { loggedOut: false, why: "couldn't find EasyWeb's Log out button" }

    // A native "Are you sure?" box is accepted; it is the person's own request.
    page.once('dialog', (dialog) => void dialog.accept().catch(() => undefined))
    await control.click({ timeout: 10_000 })

    // Up to ~15 s for EasyWeb to end the session, confirming once if it asks.
    let confirmed = false
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(1000)
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
    return { loggedOut: false, why: error instanceof Error ? (error.message.split('\n')[0] ?? 'error') : String(error) }
  }
}

/** One line for the end of a run. */
export function describeLogout(result: LogoutResult | undefined, stayed: boolean): string {
  if (stayed) return 'Still logged in to EasyWeb (--stay-signed-in). Log out and quit that Chrome when you are done.'
  if (!result) return 'Log out of EasyWeb and quit that Chrome (⌘Q) when you are done.'
  return result.loggedOut
    ? 'Logged out of EasyWeb. You can quit that Chrome window (⌘Q).'
    : `Couldn't log out of EasyWeb (${result.why}). Log out by hand and quit that Chrome (⌘Q).`
}

export const STAY_FLAG = '--stay-signed-in'
