import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConfigError, hasPlaceholderSelectors, loadConfig } from './config.js'
import { RunAbort, closeConnection, connect, openAccount, openRunPage, quitBankChrome } from './engine.js'
import { HaltRequest } from './halt.js'
import { localDateStamp } from './naming.js'
import { Pacer } from './pacing.js'
import { describePending, readPending, savePending, type PendingReading } from './pending.js'
import { STAY_FLAG, describeLogout, logOut, type LogoutResult } from './logout.js'

/**
 * `npm run pending` — refresh only the cards' pending charges, with no
 * downloads: visits each credit card's page in the logged-in Chrome, reads
 * its pending list, and updates today's TD-pending-<date>.json. Useful
 * mid-week, or after a run that skipped accounts already downloaded today.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const stayLoggedIn = args.includes(STAY_FLAG)
  const configPath = args.find((arg) => arg.endsWith('.json')) ?? join(packageRoot, 'accounts.json')
  const config = await loadConfig(configPath)
  const cards = config.accounts.filter((a) => a.kind === 'credit' && !hasPlaceholderSelectors(a))
  if (cards.length === 0) {
    console.log('No credit cards configured.')
    return
  }
  const browser = await connect(config.cdpUrl)
  const readings: PendingReading[] = []
  let logout: LogoutResult | undefined
  let closed = false
  let blocked = false
  try {
    const page = await openRunPage(browser)
    const pacer = new Pacer(config.pacing, new HaltRequest())
    for (const card of cards) {
      try {
        await openAccount(page, card, config, pacer)
        const result = await readPending(page, card.label, card.lastFour)
        if (result.reading) {
          readings.push(result.reading)
          console.log(`  ✓ ${card.label} (…${card.lastFour}): ${describePending(result.reading)}`)
          if (result.reading.currentBalance === undefined && result.raw?.balanceMarkup) {
            // The page's layout around "Current Balance", amounts masked: kept in the git-ignored runs/ folder.
            const dump = join(packageRoot, 'runs', `balance-debug-${card.lastFour}.html`)
            await mkdir(dirname(dump), { recursive: true })
            await writeFile(dump, `${result.raw.balanceMarkup}\n`, 'utf8')
            console.log(`      layout around its balance (amounts masked): ${dump}`)
          }
        } else {
          console.log(`  ✗ ${card.label} (…${card.lastFour}): couldn't read its pending charges — ${result.why}`)
          if (result.raw) {
            // What the page showed, to work out why: kept in the git-ignored runs/ folder.
            const dump = join(packageRoot, 'runs', `pending-debug-${card.lastFour}.json`)
            await mkdir(dirname(dump), { recursive: true })
            await writeFile(dump, `${JSON.stringify(result.raw, null, 2)}\n`, 'utf8')
            console.log(`      what the page showed: ${dump}`)
          }
        }
      } catch (error) {
        console.log(`  ✗ ${card.label} (…${card.lastFour}): ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
        if (error instanceof Error && error.name === 'SessionBlocked') {
          blocked = true
          break
        }
      }
    }
    if (!blocked && !stayLoggedIn) logout = await logOut(page, config.easywebHomeUrl)
  } finally {
    // Logged out: close the bank Chrome too, shutting the debugging port.
    if (logout?.loggedOut) closed = await quitBankChrome(browser)
    else await closeConnection(browser)
  }
  const file = await savePending(config.outputDir, localDateStamp(), readings)
  console.log(file ? `\nPending charges saved: ${file}` : '\nNothing saved.')
  if (!blocked) console.log(`\n${describeLogout(logout, stayLoggedIn, closed)}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError || error instanceof RunAbort ? `\n${error.message}` : error)
  process.exitCode = 1
})
