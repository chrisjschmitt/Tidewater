import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConfigError, loadConfig } from './config.js'
import { RunAbort, runDownloads } from './engine.js'
import { RUNS_DIR_NAME } from './manifest.js'
import { formatCombined, formatReport, formatSummary, notifyMac, revealInFinder } from './report.js'
import { REAUTH_MESSAGE } from './session-guard.js'
import { STAY_FLAG, describeLogout } from './logout.js'
import type { PacingRange } from './types.js'

/**
 * The CLI. Its job is arranging the pieces and printing plainly — every
 * decision that matters lives in the modules it calls.
 *
 * Exit codes: 0 when every account came back ok, 1 when anything failed, was
 * skipped, or the run was halted. A monthly job that quietly half-worked should
 * not look like a success.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const stayLoggedIn = args.includes(STAY_FLAG)
  const configPath = args.find((arg) => !arg.startsWith('--')) ?? join(packageRoot, 'accounts.json')
  const runsDir = join(packageRoot, RUNS_DIR_NAME)

  const config = await loadConfig(configPath)

  console.log('Tidewater — TD statement downloader')
  console.log(`  config    ${configPath}`)
  console.log(`  chrome    ${config.cdpUrl}`)
  console.log(`  output    ${config.outputDir}`)
  console.log(`  accounts  ${config.accounts.length}`)
  // Printed because the pauses are long enough that a watcher would otherwise
  // wonder whether the run had hung.
  console.log(`  pacing    ${seconds(config.pacing.actionDelayMs)} per action, ${seconds(config.pacing.accountDelayMs)} between accounts`)
  console.log('')

  const outcome = await runDownloads(config, runsDir, (message) => console.log(message), { stayLoggedIn })

  console.log('')
  console.log(formatReport(outcome.results))
  console.log('')
  console.log(formatSummary(outcome.results))
  console.log(`manifest: ${outcome.manifestPath}`)
  console.log('')
  const combinedLine = formatCombined(outcome.combined, config.accounts.length)
  console.log(combinedLine)
  await notifyMac('TD download finished', combinedLine)
  // Finder opens on the file, selected, ready to drag onto Tidewater's
  // Closing balances step — no file dialog to steer to the right folder.
  if (outcome.combined?.file) await revealInFinder(outcome.combined.file)

  if (outcome.sessionBlocked) {
    console.log('')
    console.log(REAUTH_MESSAGE)
  } else if (outcome.haltReason) {
    console.log('')
    console.log(`Run ended early: ${outcome.haltReason}`)
    console.log(describeLogout(outcome.logout, stayLoggedIn, outcome.chromeClosed))
    console.log('Run Download from TD again to pick up where this stopped.')
  } else {
    console.log('')
    console.log(describeLogout(outcome.logout, stayLoggedIn, outcome.chromeClosed))
  }

  const allOk = outcome.results.every((result) => result.status === 'ok')
  process.exitCode = allOk && !outcome.haltReason ? 0 : 1
}

const seconds = (range: PacingRange) => `${(range.minMs / 1000).toFixed(1)}–${(range.maxMs / 1000).toFixed(1)}s`

main().catch((error: unknown) => {
  // ConfigError and RunAbort are the two things a person can act on, so they
  // print as advice rather than as a stack trace.
  if (error instanceof ConfigError || error instanceof RunAbort) {
    console.error(`\n${error.message}`)
  } else {
    console.error('\nThe run stopped on an unexpected error. It logged out and closed the bank Chrome where it could —')
    console.error('if that window is still open, log out of EasyWeb and quit it (⌘Q).')
    console.error(error)
  }
  process.exitCode = 1
})
