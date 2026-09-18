import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'

import { PLACEHOLDER_MESSAGE, SELECTOR_PLACEHOLDER, hasPlaceholderSelectors } from './config.js'
import { HaltRequest, installSigintHandler } from './halt.js'
import { RunLog, alreadyOkToday, resumeKey } from './manifest.js'
import { localDateStamp, outputFilename, partialFilename } from './naming.js'
import { Pacer } from './pacing.js'
import { checkSession } from './session-guard.js'
import type { AccountConfig, AccountResult, ExportStep, RunConfig } from './types.js'

/**
 * The run itself: attach to a Chrome the user already logged into, walk the
 * accounts in config order, and save one CSV per account.
 *
 * Two shapes matter more than the code:
 *
 * - **Nothing here authenticates.** The browser is found, never launched, and
 *   there is no code path that could type into a login form. If the page stops
 *   looking logged in, the run ends and asks for human hands.
 * - **Accounts are independent.** One account throwing is that account's
 *   result, not the run's. The checkpoint after each one is what makes an
 *   interrupted evening resumable.
 *
 * The loop is strictly sequential and every account shares one tab, opened once
 * before the first account and reused to the end. Nine tabs loading at once, or
 * nine accounts in flight, would be both unwatchable and unlike anything a
 * person does — and the run is meant to be watched. Pacing between actions
 * comes from pacing.ts; see that file for what it is and is not for.
 */

/** How long the in-flight account gets to finish after the first Ctrl+C. */
const HALT_GRACE_MS = 15_000

/** A download that has not started in this long is not going to. */
const DOWNLOAD_TIMEOUT_MS = 60_000

const STEP_TIMEOUT_MS = 20_000
const NAV_TIMEOUT_MS = 45_000

export interface RunOutcome {
  results: AccountResult[]
  manifestPath: string
  haltReason?: string
  /** True when the run ended because the page stopped looking logged in. */
  sessionBlocked?: boolean
}

export class RunAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunAbort'
  }
}

/** Raised by the session guard; ends the whole run rather than one account. */
class SessionBlocked extends Error {
  constructor(readonly detail: string) {
    super(detail)
    this.name = 'SessionBlocked'
  }
}

export async function runDownloads(
  config: RunConfig,
  runsDir: string,
  log: (message: string) => void,
): Promise<RunOutcome> {
  const dateStamp = localDateStamp()
  const done = await alreadyOkToday(runsDir, dateStamp)
  const runLog = await RunLog.start(runsDir, { cdpUrl: config.cdpUrl, outputDir: config.outputDir })

  const halt = new HaltRequest()
  const removeSigintHandler = installSigintHandler(halt, log)
  const pacer = new Pacer(config.pacing, halt)

  // Deciding this before Chrome is contacted is what keeps a fresh checkout
  // harmless: with the shipped placeholder config there is nothing to attach
  // to and nothing to click.
  const pending = config.accounts.filter((account) => !done.has(resumeKey(account.label, account.lastFour)))
  const actionable = pending.filter((account) => !hasPlaceholderSelectors(account))

  let browser: Browser | null = null
  let page: Page | null = null
  let haltReason: string | undefined
  let sessionBlocked = false
  /** True once an account has actually driven the page, so pauses only go between real work. */
  let touchedPage = false

  try {
    if (actionable.length > 0) {
      if (config.easywebHomeUrl === SELECTOR_PLACEHOLDER) {
        throw new RunAbort(
          'Some accounts have real selectors but "easywebHomeUrl" is still a placeholder. Set it to the EasyWeb account summary URL in accounts.json.',
        )
      }
      await mkdir(config.outputDir, { recursive: true })
      browser = await connect(config.cdpUrl)
      page = await openRunPage(browser)
    }

    for (const account of config.accounts) {
      const key = resumeKey(account.label, account.lastFour)

      if (done.has(key)) {
        await runLog.record({
          label: account.label,
          lastFour: account.lastFour,
          status: 'skipped',
          error: 'already ok today',
          finishedAt: new Date().toISOString(),
        })
        log(`  skip  ${account.label} — already ok today`)
        continue
      }

      // Placeholders are answered without ever looking at the page. Guessing
      // EasyWeb's markup and clicking around a live banking session to find out
      // if the guess was right is not a trade this tool makes.
      if (hasPlaceholderSelectors(account)) {
        await runLog.record({
          label: account.label,
          lastFour: account.lastFour,
          status: 'failed',
          error: PLACEHOLDER_MESSAGE,
          finishedAt: new Date().toISOString(),
        })
        log(`  fail  ${account.label} — ${PLACEHOLDER_MESSAGE}`)
        continue
      }

      // The checkpoint boundary: a halt asked for during the previous account
      // stops here rather than starting another one.
      if (halt.requested) {
        haltReason = 'stopped at your request (Ctrl+C)'
        break
      }

      if (!page) throw new RunAbort('Internal error: no page was opened for a configured account.')

      // The longer pause belongs here, after the halt check, so a Ctrl+C stops
      // the run instead of sitting through it. Accounts that were skipped or
      // never touched the page do not earn a pause — there is nothing to be
      // calm about.
      if (touchedPage) {
        const waited = await pacer.betweenAccounts()
        if (halt.requested) {
          // Ctrl+C arrived mid-pause, which cut it short. Nothing has been
          // touched since the last checkpoint, so this is a clean place to stop.
          haltReason = 'stopped at your request (Ctrl+C)'
          break
        }
        log(`  wait  ${(waited / 1000).toFixed(1)}s before the next account`)
      }

      let result: AccountResult
      touchedPage = true
      try {
        result = await runOneAccount(page, account, config, dateStamp, halt, pacer, log)
      } catch (error) {
        // A session problem surfaced inside this account. It is recorded here,
        // where we still know whose account it was, before it ends the run.
        if (error instanceof SessionBlocked) {
          await runLog.record({
            label: account.label,
            lastFour: account.lastFour,
            status: 'halted',
            error: error.detail,
            finishedAt: new Date().toISOString(),
          })
        }
        throw error
      }
      await runLog.record(result)

      if (result.status === 'ok') log(`  ok    ${account.label} — ${result.file ?? ''}`)
      else if (result.status === 'halted') log(`  halt  ${account.label} — ${result.error ?? ''}`)
      else log(`  fail  ${account.label} — ${result.error ?? ''}`)

      if (result.status === 'halted') {
        haltReason = 'stopped at your request (Ctrl+C)'
        break
      }
    }

    if (haltReason) await runLog.halt(haltReason)
  } catch (error) {
    if (error instanceof SessionBlocked) {
      haltReason = error.detail
      sessionBlocked = true
      await runLog.halt(error.detail)
    } else {
      await runLog.halt(messageOf(error))
      await markRemaining(runLog, config, messageOf(error))
      await closeConnection(browser)
      removeSigintHandler()
      await runLog.finish()
      throw error
    }
  }

  if (haltReason) await markRemaining(runLog, config, `not attempted — ${haltReason}`)

  await closeConnection(browser)
  removeSigintHandler()
  await runLog.finish()

  const outcome: RunOutcome = { results: [...runLog.results], manifestPath: runLog.file }
  if (haltReason !== undefined) outcome.haltReason = haltReason
  if (sessionBlocked) outcome.sessionBlocked = true
  return outcome
}

async function connect(cdpUrl: string): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(cdpUrl)
  } catch {
    throw new RunAbort(
      [
        `Could not reach Chrome at ${cdpUrl}.`,
        '',
        'Start Chrome with ./launch-chrome.sh and log into EasyWeb first, then run this again.',
      ].join('\n'),
    )
  }
}

/**
 * A fresh tab in the user's existing context, so the session cookies are the
 * ones they authenticated with. Their own tabs are read for context and never
 * driven or closed — the run needs a page of its own precisely so it cannot
 * disturb whatever they were doing.
 */
async function openRunPage(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0]
  if (!context) {
    throw new RunAbort(
      'Chrome is listening but has no browser context. Open a window, log into EasyWeb, and run this again.',
    )
  }
  const page = await context.newPage()
  page.setDefaultTimeout(STEP_TIMEOUT_MS)
  return page
}

async function runOneAccount(
  page: Page,
  account: AccountConfig,
  config: RunConfig,
  dateStamp: string,
  halt: HaltRequest,
  pacer: Pacer,
  log: (message: string) => void,
): Promise<AccountResult> {
  log(`  ...   ${account.label} (…${account.lastFour})`)

  const finalName = outputFilename(account.label, account.lastFour, dateStamp)
  const finalPath = join(config.outputDir, finalName)
  const partialPath = join(config.outputDir, partialFilename(finalName))

  const work = downloadAccount(page, account, config, pacer, finalPath, partialPath)

  // The in-flight account races the grace period rather than being cancelled
  // outright: a download two seconds from done is worth waiting for, a wedged
  // page is not worth waiting on forever.
  const outcome = await Promise.race([
    work.then((file) => ({ kind: 'done' as const, file })).catch((error: unknown) => ({ kind: 'error' as const, error })),
    halt.grace(HALT_GRACE_MS).then(() => ({ kind: 'halted' as const })),
  ])

  if (outcome.kind === 'halted') {
    // Whatever the page does next, no half-written file is left behind under a
    // name anything downstream would read.
    await rm(partialPath, { force: true }).catch(() => undefined)
    return {
      label: account.label,
      lastFour: account.lastFour,
      status: 'halted',
      error: `interrupted before finishing (${HALT_GRACE_MS / 1000}s grace elapsed)`,
      finishedAt: new Date().toISOString(),
    }
  }

  if (outcome.kind === 'error') {
    await rm(partialPath, { force: true }).catch(() => undefined)
    // A session problem is the run's problem, so it is rethrown past the
    // per-account boundary.
    if (outcome.error instanceof SessionBlocked) throw outcome.error
    return {
      label: account.label,
      lastFour: account.lastFour,
      status: 'failed',
      error: messageOf(outcome.error),
      finishedAt: new Date().toISOString(),
    }
  }

  return {
    label: account.label,
    lastFour: account.lastFour,
    status: 'ok',
    file: outcome.file,
    finishedAt: new Date().toISOString(),
  }
}

async function downloadAccount(
  page: Page,
  account: AccountConfig,
  config: RunConfig,
  pacer: Pacer,
  finalPath: string,
  partialPath: string,
): Promise<string> {
  // Back to the summary each time. Starting every account from the same known
  // page means one account's half-finished navigation cannot mislead the next.
  await pacer.beforeAction()
  await page.goto(config.easywebHomeUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  await guard(page)

  // Think time before the click as well as before the navigation: the pause a
  // person takes finding a link on a page they just loaded.
  await pacer.beforeAction()
  await page.click(account.accountLink, { timeout: STEP_TIMEOUT_MS })
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT_MS }).catch(() => undefined)
  await guard(page)

  // The listener is armed before the steps run, because the download can start
  // on the very click that finishes the sequence. Its budget therefore has to
  // cover the think time still to come, or pacing would look like a timeout.
  const thinkTimeAhead = account.exportSteps.length * config.pacing.actionDelayMs.maxMs
  const downloadPromise = page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS + thinkTimeAhead })

  for (const step of account.exportSteps) {
    await pacer.beforeAction()
    await applyStep(page, step)
  }

  const download = await downloadPromise

  // Temp name first, rename after: a reader watching this directory should
  // never see a partially written CSV under its final name.
  await download.saveAs(partialPath)
  await rename(partialPath, finalPath)

  // Checked after the export too — an export click is a common place for a
  // timed-out session to surface.
  await guard(page)

  return finalPath
}

/**
 * Every action goes through Playwright's ordinary high-level methods, never
 * `dispatchEvent` or an evaluated JS click. Those shortcuts are both less honest
 * and less safe: `click()` waits for the element to be visible, stable, and
 * hit-testable, then drives real hover and mouse events at real coordinates, so
 * a click that a person could not have made fails loudly instead of firing a
 * synthetic event at a hidden control.
 */
async function applyStep(page: Page, step: ExportStep): Promise<void> {
  switch (step.action) {
    case 'click':
      await page.click(step.selector, { timeout: STEP_TIMEOUT_MS })
      return
    case 'selectOption':
      await page.selectOption(step.selector, step.value ?? '', { timeout: STEP_TIMEOUT_MS })
      return
    case 'fill':
      await page.fill(step.selector, step.value ?? '', { timeout: STEP_TIMEOUT_MS })
      return
    case 'check':
      await page.check(step.selector, { timeout: STEP_TIMEOUT_MS })
      return
    case 'waitFor':
      await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS })
      return
  }
}

async function guard(page: Page): Promise<void> {
  const check = await checkSession(page)
  if (check.blocked) throw new SessionBlocked(check.reason ?? 'the page no longer looks like a logged-in session')
}

/**
 * Everything the run never got to is written down as `skipped` so the manifest
 * accounts for all nine, and so a resume knows they are still owed.
 */
async function markRemaining(runLog: RunLog, config: RunConfig, reason: string): Promise<void> {
  const recorded = new Set(runLog.results.map((result) => resumeKey(result.label, result.lastFour)))
  for (const account of config.accounts) {
    if (recorded.has(resumeKey(account.label, account.lastFour))) continue
    await runLog.record({
      label: account.label,
      lastFour: account.lastFour,
      status: 'skipped',
      error: reason,
      finishedAt: new Date().toISOString(),
    })
  }
}

/**
 * `browser.close()` on a connectOverCDP connection **disconnects** Playwright
 * from Chrome; it does not close the user's browser. That asymmetry is the
 * reason this is the only teardown here: no page or context is closed, nothing
 * is navigated away as cleanup, and nothing logs out. The window is left
 * exactly as the user left it, still signed in.
 */
async function closeConnection(browser: Browser | null): Promise<void> {
  if (!browser) return
  await browser.close().catch(() => undefined)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
