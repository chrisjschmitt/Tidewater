/**
 * Read-only eyes for the paired live session.
 *
 * The downloader needs selectors nobody wants to guess, and guessing is the
 * one thing this tool refuses to do. So this script attaches to the same
 * Chrome the downloader would — the one *you* logged into — and does nothing
 * but look: list the open tabs, or describe the clickable things on the tab
 * you are looking at, so the right selector can be chosen and written into
 * accounts.json by hand.
 *
 * It never clicks, types, fills, navigates, or closes anything. The only
 * page-side work is a DOM query, and the teardown is the same disconnect the
 * engine uses: your window is left exactly as it was.
 *
 *   npm run inspect                       list open tabs
 *   npm run inspect -- --page easyweb     describe the tab whose URL or title
 *                                         contains "easyweb"
 *   npm run inspect -- --page easyweb --selector "a:has-text('Expense')"
 *                                         count and describe what a candidate
 *                                         selector would match
 */

import process from 'node:process'

import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'

const CDP_URL = process.env.TD_CDP_URL ?? 'http://localhost:9222'

interface ElementSketch {
  tag: string
  text: string
  id: string
  name: string
  ariaLabel: string
  href: string
  type: string
  visible: boolean
}

/** Trimmed and collapsed, so a menu of forty links stays readable. */
const tidy = (value: string, max = 90): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

function sketchLine(sketch: ElementSketch, index: number): string {
  const bits = [`[${index}] <${sketch.tag}>`]
  if (sketch.text) bits.push(`text="${sketch.text}"`)
  if (sketch.id) bits.push(`id=${sketch.id}`)
  if (sketch.name) bits.push(`name=${sketch.name}`)
  if (sketch.ariaLabel) bits.push(`aria-label="${sketch.ariaLabel}"`)
  if (sketch.type) bits.push(`type=${sketch.type}`)
  if (sketch.href) bits.push(`href=${sketch.href}`)
  if (!sketch.visible) bits.push('(hidden)')
  return `  ${bits.join('  ')}`
}

/**
 * Everything a selector could reasonably hang off, read in one evaluation.
 * Text is cut short: this output is for finding elements, not for reading
 * the page, and a banking page holds figures that have no business in a log.
 *
 * The code ships as a string rather than a function because tsx's bundler
 * decorates serialized functions with helpers (`__name`) that do not exist
 * inside the page, and an inspector that crashes the moment it looks is no
 * inspector at all.
 */
const DESCRIBE_JS = `(() => {
  const cut = (value, max) => {
    const collapsed = (value ?? '').replace(/\\s+/g, ' ').trim()
    return collapsed.length > max ? collapsed.slice(0, max - 1) + '…' : collapsed
  }
  const sketch = (el) => {
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      text: cut(el.textContent, 60),
      id: el.id ?? '',
      name: el.getAttribute('name') ?? '',
      ariaLabel: cut(el.getAttribute('aria-label'), 60),
      href: cut(el.getAttribute('href'), 90),
      type: el.getAttribute('type') ?? '',
      visible: rect.width > 0 && rect.height > 0,
    }
  }
  const grab = (css, limit) =>
    Array.from(document.querySelectorAll(css)).slice(0, limit).map(sketch)
  return {
    links: grab('a', 80),
    buttons: grab('button, input[type=button], input[type=submit]', 40),
    selects: grab('select', 20),
    inputs: grab('input:not([type=button]):not([type=submit]):not([type=hidden])', 20),
    frames: Array.from(document.querySelectorAll('iframe')).map((el) => cut(el.getAttribute('src'), 110)),
  }
})()`

async function describeInteractive(page: Page): Promise<Record<string, ElementSketch[] | string[]>> {
  return page.evaluate(DESCRIBE_JS)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const pageFilter = valueOf(args, '--page')
  const selector = valueOf(args, '--selector')

  let browser: Browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL)
  } catch {
    console.error(`Could not reach Chrome at ${CDP_URL}.`)
    console.error('Start it with ./launch-chrome.sh and log into EasyWeb first.')
    process.exitCode = 1
    return
  }

  try {
    const pages = browser.contexts().flatMap((context) => context.pages())

    if (!pageFilter) {
      console.log(`Open tabs (${pages.length}):`)
      for (const [index, page] of pages.entries()) {
        console.log(`  [${index}] ${tidy(await page.title(), 60)}`)
        console.log(`      ${tidy(page.url(), 110)}`)
      }
      console.log('\nDescribe one with:  npm run inspect -- --page <part of its url or title>')
      return
    }

    const needle = pageFilter.toLowerCase()
    const matches: Page[] = []
    for (const page of pages) {
      const title = (await page.title()).toLowerCase()
      if (page.url().toLowerCase().includes(needle) || title.includes(needle)) matches.push(page)
    }
    const page = matches[0]
    if (!page) {
      console.error(`No open tab matches "${pageFilter}". Run without arguments to list tabs.`)
      process.exitCode = 1
      return
    }
    if (matches.length > 1) {
      console.log(`(${matches.length} tabs match; describing the first)`)
    }

    console.log(`Tab: ${tidy(await page.title(), 80)}`)
    console.log(`URL: ${tidy(page.url(), 140)}\n`)

    if (selector) {
      // A candidate selector is judged the way the engine would use it: how
      // many elements it matches, and what the first few look like. One
      // visible match is what a config entry wants.
      const located = page.locator(selector)
      const count = await located.count()
      console.log(`Selector ${JSON.stringify(selector)} matches ${count} element(s).`)
      const limit = Math.min(count, 5)
      for (let i = 0; i < limit; i++) {
        const handle = located.nth(i)
        const text = tidy((await handle.textContent().catch(() => '')) ?? '', 70)
        const visible = await handle.isVisible().catch(() => false)
        const tag = await handle
          .evaluate('el => el.tagName.toLowerCase()')
          .catch(() => '?')
        const aria = tidy(
          ((await handle.getAttribute('aria-label').catch(() => '')) ?? '') || '',
          70,
        )
        const bits = [`[${i}] <${String(tag)}>`, `text="${text}"`]
        if (aria) bits.push(`aria-label="${aria}"`)
        if (!visible) bits.push('(hidden)')
        console.log(`  ${bits.join('  ')}`)
      }
      return
    }

    const described = await describeInteractive(page)
    for (const [group, entries] of Object.entries(described)) {
      if (entries.length === 0) continue
      console.log(`${group} (${entries.length}):`)
      entries.forEach((item, index) => {
        if (typeof item === 'string') console.log(`  [${index}] src=${item}`)
        else console.log(sketchLine(item, index))
      })
      console.log('')
    }
  } finally {
    // Same asymmetry the engine relies on: closing a connectOverCDP browser
    // object disconnects from Chrome without closing it.
    await browser.close().catch(() => undefined)
  }
}

function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

void main()
