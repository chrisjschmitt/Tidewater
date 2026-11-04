import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConfigError, hasPlaceholderSelectors, loadConfig } from './config.js'
import { RunAbort, closeConnection, connect, openAccount, openRunPage } from './engine.js'
import { HaltRequest } from './halt.js'
import { localDateStamp } from './naming.js'
import { Pacer } from './pacing.js'
import { describePending, readPending, savePending, type PendingReading } from './pending.js'

/**
 * `npm run pending` — refresh only the cards' pending charges, with no
 * downloads: visits each credit card's page in the logged-in Chrome, reads
 * its pending list, and updates today's TD-pending-<date>.json. Useful
 * mid-week, or after a run that skipped accounts already downloaded today.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')

async function main(): Promise<void> {
  const configPath = process.argv.slice(2).find((arg) => arg.endsWith('.json')) ?? join(packageRoot, 'accounts.json')
  const config = await loadConfig(configPath)
  const cards = config.accounts.filter((a) => a.kind === 'credit' && !hasPlaceholderSelectors(a))
  if (cards.length === 0) {
    console.log('No credit cards configured.')
    return
  }
  const browser = await connect(config.cdpUrl)
  const readings: PendingReading[] = []
  try {
    const page = await openRunPage(browser)
    const pacer = new Pacer(config.pacing, new HaltRequest())
    for (const card of cards) {
      try {
        await openAccount(page, card, config, pacer)
        const reading = await readPending(page, card.label, card.lastFour)
        if (reading) {
          readings.push(reading)
          console.log(`  ✓ ${card.label} (…${card.lastFour}): ${describePending(reading)}`)
        } else console.log(`  ✗ ${card.label} (…${card.lastFour}): couldn't read its pending charges`)
      } catch (error) {
        console.log(`  ✗ ${card.label} (…${card.lastFour}): ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
        if (error instanceof Error && error.name === 'SessionBlocked') break
      }
    }
  } finally {
    await closeConnection(browser)
  }
  const file = await savePending(config.outputDir, localDateStamp(), readings)
  console.log(file ? `\nPending charges saved: ${file}` : '\nNothing saved.')
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError || error instanceof RunAbort ? `\n${error.message}` : error)
  process.exitCode = 1
})
