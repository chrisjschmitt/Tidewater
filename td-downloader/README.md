# td-downloader

Pulls the monthly CSV transaction export for each of the nine TD accounts, so
the ETM import has files to read instead of an hour of clicking.

It is deliberately half a tool. **You** log into EasyWeb by hand, in a Chrome
window you can see; the downloader attaches to that already-authenticated
session and does the clicking. There is no field, flag, prompt, or environment
variable anywhere in here for a password, an MFA code, or a TOTP secret — the
tool never sees a login form, and if one appears it stops.

## The monthly run

```bash
cd td-downloader

# 1. Launch the dedicated Chrome window (headed, debugging port open).
./launch-chrome.sh

# 2. In that window: go to EasyWeb and log in BY HAND, including MFA.
#    Leave it open and logged in.

# 3. In another terminal:
npm install                                # first time only
cp accounts.example.json accounts.json     # first time only, then fill it in
npm run download
```

Progress prints per account as it goes, and the run ends with a status table
and a one-line `n ok / n failed / n skipped` summary.

You do **not** need `npx playwright install`. Playwright's bundled browsers are
never used — the tool only ever attaches to your real Chrome over CDP, and it
will never launch a browser itself.

## Where the files land

`outputDir` in `accounts.json`, `~/TD-Statements` by default. Names follow a
fixed contract, because another part of Tidewater reads these files by name:

```
TD-<label-slug>-<lastFour>-<YYYY-MM-DD>.csv

TD-expense-account-6016-2026-09-18.csv
TD-td-aeroplan-visa-infinite-5689-2026-09-18.csv
```

`label-slug` is the account's `label` lowercased, with runs of non-alphanumeric
characters collapsed to single dashes. The date is today's local date. Downloads
are written under a temp name and renamed on completion, so an interrupted run
never leaves a partial file under a real name.

A re-run on the same day overwrites its own files. Files from other days are
never touched.

## Looking human

The run moves at a person's pace rather than a script's. Before every
navigation and every export step it pauses 1.5–4 seconds, and between accounts
4–10 seconds, each drawn randomly from its range. Accounts are done strictly one
at a time, in config order, in a single tab that is opened once and reused —
never nine tabs, never two accounts at once. Clicks go through Playwright's
ordinary `click()`, which waits for the element to be visible and stable and
then drives real hover and mouse events, rather than firing synthetic events at
the DOM.

Two reasons. A burst of instant clicks across nine accounts is the kind of
traffic that earns a CAPTCHA, and a run at human speed is one you can actually
watch and stop when it does something unexpected.

**This is not evasion, and it is not meant to be.** Nothing here disguises the
browser or hides that Playwright is driving it: it is your own Chrome, started
with no automation flags, so `navigator.webdriver` is false and there is no
automation banner simply because neither is true. There are no stealth plugins,
no fingerprint or user-agent spoofing, and nothing that solves, retries, or
waits out a challenge. If TD shows a CAPTCHA or a step-up prompt anyway, the
session guard stops the run on the spot and hands it back to you — that is the
intended outcome, not a failure to work around.

Tune it in `accounts.json` if you want it gentler:

```json
"pacing": {
  "actionDelayMs": [1500, 4000],
  "accountDelayMs": [4000, 10000]
}
```

Both fields are optional, as is the whole `pacing` block; the values above are
the defaults. Pauses are interruptible, so Ctrl+C during a ten-second wait stops
then rather than ten seconds later.

## Halting: Ctrl+C

The first Ctrl+C is a request to stop. The account in flight gets fifteen
seconds to finish, then the run stops rather than starting the next account. A
second Ctrl+C exits immediately.

Either way **your Chrome window is left exactly as it was** — still logged in,
nothing closed, nothing navigated away, no logout. The only teardown the tool
performs is `browser.close()` on its CDP connection, which for
`connectOverCDP` disconnects Playwright and leaves the browser alone.

## Resuming

Every run writes `runs/run-<timestamp>.json` and updates it **between**
accounts, never mid-account. On start, the tool reads today's manifests and
skips any account already recorded `ok` today. So an interrupted evening picks
up where it left off, and three partial runs still add up to nine accounts.

`runs/` is gitignored — these files name real accounts and their last four
digits.

## When the session expires, or a CAPTCHA appears

Before and after each navigation the tool checks whether the page still looks
like a live, logged-in session: login-ish URLs, password fields, CAPTCHA
iframes and containers, "verify your identity"-style text. If any of that
shows up, the whole run stops on the spot, the accounts it never reached are
recorded as `skipped`, and it prints a message asking you to re-authenticate.

It will not try to log in, will not wait a challenge out, and contains no
anti-detection tricks. Fix it in the Chrome window by hand, then re-run — the
accounts already downloaded today are skipped.

The heuristics all live in `src/session-guard.ts`, so adding a marker EasyWeb
starts using is a one-file change.

## Filling in the selectors (the paired live session)

**The shipped `accounts.json` has no real selectors.** Every selector field is
the literal string `TODO-set-in-live-session`, and the tool recognises it:
those accounts are reported `failed` with "selectors not configured" and the
page is never touched. Running today is therefore a safe no-op — it does not
even connect to Chrome if nothing is configured.

That is on purpose. EasyWeb's markup is not something to guess at, and a wrong
selector clicking around inside a logged-in banking session is the failure mode
most worth avoiding. So the selectors get captured once, together, against the
real site:

1. Run `./launch-chrome.sh` and log into EasyWeb by hand.
2. Attach Playwright's codegen/inspector to that same session:

   ```bash
   npx playwright codegen --target=javascript
   ```

   Point it at the running Chrome via CDP (`npx playwright codegen` supports
   attaching; the inspector's "Pick locator" is the part we want). Clicking
   through one account's export by hand gives back the exact locators for each
   step.
3. For each account, fill in:
   - `accountLink` — how to reach that account from the EasyWeb summary page.
     Playwright selector syntax, so `text=Expense Account` is as valid as CSS.
   - `exportSteps` — the ordered clicks and dropdown choices that trigger the
     CSV download. The last step is expected to start the download; the tool
     arms its download listener around the whole sequence, so a confirmation
     click after it is fine.
4. Set `easywebHomeUrl` to the account summary URL.
5. Do one account end to end, confirm the file appears with the right name,
   then do the rest.

Field-by-field reference: `accounts.schema.md`.

## What stays local

The repo this lives in is public, so the code is written to be pushable and the
data is not:

- `accounts.json` is **gitignored**. It names the real accounts, their last-four
  digits, and — once the live session fills them in — the exact navigation for
  each. Only the sanitized `accounts.example.json` is committed; copy it and
  fill it in locally.
- `runs/` is gitignored for the same reason: manifests name real accounts.
- The Chrome profile (`~/.td-downloader-profile`) holds a live EasyWeb session
  and lives in `$HOME`, outside the repo entirely.
- The downloads themselves land in `outputDir` (`~/TD-Statements` by default),
  also outside the repo.

Nothing in `src/` knows an account: every name, digit, and selector arrives
from the local config at run time.

## Guardrails, in short

- Attaches only, over CDP, to `localhost` — never launches a browser, never
  headless.
- Paces itself like a person, but spoofs nothing and fights no challenge.
- Handles no credentials of any kind, at any layer.
- Only navigation clicks and export-trigger clicks/selects. The step vocabulary
  has nothing in it that could submit a payment or a transfer.
- Stops the whole run on any login, session-expiry, CAPTCHA, or step-up page.
- Only teardown is disconnecting from Chrome. No page or context is closed,
  nothing is navigated away as cleanup, nothing logs out.
- Checkpoints between accounts, never mid-account. One account failing does not
  stop the others.

## Layout

| File                  | What it holds |
| --------------------- | ------------- |
| `launch-chrome.sh`    | Starts headed Chrome with a debugging port and its own profile. |
| `accounts.json`       | The nine accounts in run order, plus `cdpUrl`, `outputDir`, `easywebHomeUrl`. |
| `accounts.schema.md`  | Field reference for the above. |
| `src/config.ts`       | Loading and validating the config; placeholder detection. |
| `src/pacing.ts`       | Randomized think time, and why it is not evasion. |
| `src/session-guard.ts`| Every "is this still a logged-in session?" heuristic. |
| `src/engine.ts`       | Connect, per-account loop, download and rename. |
| `src/manifest.ts`     | Run manifests and same-day resume. |
| `src/halt.ts`         | Ctrl+C semantics. |
| `src/naming.ts`       | The output filename contract. |
| `src/report.ts`       | The end-of-run table and summary. |
| `src/index.ts`        | CLI wiring and exit codes. |
