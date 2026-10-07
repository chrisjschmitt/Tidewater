import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { combineDay } from './combine.js'
import { ConfigError, loadConfig } from './config.js'
import { localDateStamp } from './naming.js'
import { formatCombined } from './report.js'

/**
 * `npm run combine [YYYY-MM-DD] [config]` — rebuild the combined file by hand,
 * e.g. after downloading one account manually from EasyWeb and saving it under
 * the per-account name. Defaults to today. Touches nothing in Chrome.
 */

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dateStamp = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? localDateStamp()
  const configPath = args.find((arg) => arg.endsWith('.json')) ?? join(packageRoot, 'accounts.json')
  const config = await loadConfig(configPath)
  const combined = await combineDay(config.accounts, config.outputDir, dateStamp)
  for (const account of combined.included) console.log(`  ✓ ${account.label} (…${account.lastFour}): ${account.rows} ${account.rows === 1 ? "row" : "rows"}`)
  console.log(formatCombined(combined, config.accounts.length))
  process.exitCode = combined.file ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? `\n${error.message}` : error)
  process.exitCode = 1
})
