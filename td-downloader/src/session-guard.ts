import type { Page } from 'playwright'

/**
 * Decides whether the page in front of us has stopped being a logged-in
 * banking session and become something we must not touch: a login form, an
 * expired session, a CAPTCHA, or a step-up identity challenge.
 *
 * The tool's answer to all four is identical and final — stop everything and
 * ask the person to sort it out by hand. There is deliberately no retry, no
 * waiting it out, and nothing that could be read as working around a
 * challenge. The heuristics live here alone so that adding a marker later is a
 * one-file change, and so that "what counts as a challenge" is never scattered
 * through the engine.
 */

export interface SessionCheck {
  blocked: boolean
  /** What tripped the check, for the message printed to the user. */
  reason?: string
}

const URL_MARKERS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\/login/i, reason: 'the URL looks like a login page' },
  { pattern: /\/logon/i, reason: 'the URL looks like a logon page' },
  { pattern: /signin|sign-in/i, reason: 'the URL looks like a sign-in page' },
  { pattern: /easywebsocial\/.*login/i, reason: 'the URL is an EasyWeb login path' },
  { pattern: /authentication|authenticate/i, reason: 'the URL looks like an authentication step' },
  { pattern: /session(-|_)?(expired|timeout)/i, reason: 'the URL says the session expired' },
  { pattern: /timeout/i, reason: 'the URL looks like a session timeout page' },
  { pattern: /captcha/i, reason: 'the URL mentions a CAPTCHA' },
]

const DOM_MARKERS: ReadonlyArray<{ selector: string; reason: string }> = [
  { selector: 'input[type=password]', reason: 'there is a password field on the page' },
  { selector: 'iframe[src*="captcha"]', reason: 'there is a CAPTCHA iframe on the page' },
  { selector: 'iframe[src*="recaptcha"]', reason: 'there is a reCAPTCHA iframe on the page' },
  { selector: 'iframe[src*="hcaptcha"]', reason: 'there is an hCaptcha iframe on the page' },
  { selector: '.g-recaptcha', reason: 'there is a reCAPTCHA container on the page' },
  { selector: '#recaptcha', reason: 'there is a reCAPTCHA container on the page' },
  { selector: '.h-captcha', reason: 'there is an hCaptcha container on the page' },
  { selector: '[data-sitekey]', reason: 'there is a CAPTCHA widget on the page' },
]

const TEXT_MARKERS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /verify your identity/i, reason: 'the page asks to verify your identity' },
  { pattern: /identity verification/i, reason: 'the page is an identity verification step' },
  { pattern: /enter the code we sent/i, reason: 'the page is asking for a one-time code' },
  { pattern: /verification code/i, reason: 'the page is asking for a verification code' },
  { pattern: /one[- ]time passcode/i, reason: 'the page is asking for a one-time passcode' },
  { pattern: /your session has (expired|timed out)/i, reason: 'the page says the session expired' },
  { pattern: /you have been logged out/i, reason: 'the page says you were logged out' },
  { pattern: /please (log|sign) in( again)?/i, reason: 'the page is asking you to log in' },
  { pattern: /i'?m not a robot/i, reason: 'the page is showing a CAPTCHA challenge' },
]

export async function checkSession(page: Page): Promise<SessionCheck> {
  const url = page.url()
  for (const marker of URL_MARKERS) {
    if (marker.pattern.test(url)) return { blocked: true, reason: marker.reason }
  }

  for (const marker of DOM_MARKERS) {
    // Zero-timeout count() rather than a wait: this check runs often, and a
    // healthy page should never pay for it.
    const count = await page.locator(marker.selector).count().catch(() => 0)
    if (count > 0) return { blocked: true, reason: marker.reason }
  }

  // Text is checked last and against the body only. It is the fuzziest signal,
  // so it should not be what decides a page that the cheaper checks cleared —
  // but a step-up challenge with no password field would slip past otherwise.
  const text = await page
    .locator('body')
    .first()
    .innerText({ timeout: 2_000 })
    .catch(() => '')

  if (text) {
    for (const marker of TEXT_MARKERS) {
      if (marker.pattern.test(text)) return { blocked: true, reason: marker.reason }
    }
  }

  return { blocked: false }
}

/** The one message the user needs when any of the above trips. */
export const REAUTH_MESSAGE = [
  'Stopping the run: this no longer looks like a live, logged-in EasyWeb session.',
  '',
  'Nothing was closed and nothing was logged out — your Chrome window is exactly as it was.',
  'Switch to that window, sort the login or challenge out by hand, then run `npm run download`',
  'again. Accounts already downloaded today will be skipped.',
].join('\n')
