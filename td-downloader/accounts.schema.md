# `accounts.json`

The whole config for a run. JSON rather than TypeScript so it can be edited
mid-session, live, without restarting a build.

Every selector in the shipped file is the literal string
`TODO-set-in-live-session`. That is deliberate: EasyWeb's markup is not
something to guess at from memory, and a wrong selector clicking around inside
a logged-in banking session is exactly the failure mode worth avoiding. The
downloader recognises the placeholder and marks the account `failed` without
touching the page, so an unconfigured run is a no-op rather than a hazard.
Fill them in during the paired live session described in `README.md`.

## Top level

| Field            | Type     | Notes |
| ---------------- | -------- | ----- |
| `cdpUrl`         | string   | Where Chrome's debugging port is listening. Must be `http://localhost:<port>` or `http://127.0.0.1:<port>` — a remote debugger is not something this tool will attach to. Default port matches `launch-chrome.sh`. |
| `outputDir`      | string   | Where the CSVs land. A leading `~` expands to your home directory. Created if missing. |
| `easywebHomeUrl` | string   | The page the run starts from — the EasyWeb account summary. Placeholder until the live session. |
| `pacing`         | object   | Optional. How long the run pauses to "think". Omit it, or omit either field inside it, to take the defaults. See below. |
| `accounts`       | array    | The nine accounts, **in the order they should be visited**. Order is the run order and the resume order. |

## `pacing`

Both fields are `[min, max]` milliseconds, and each delay is drawn uniformly
from its range so no two runs share a rhythm.

| Field            | Default        | Applies |
| ---------------- | -------------- | ------- |
| `actionDelayMs`  | `[1500, 4000]` | Before every navigation and every export step. |
| `accountDelayMs` | `[4000, 10000]` | Between accounts, at the checkpoint. |

Validation is picky on purpose: each must be a two-number array, neither number
negative, and the minimum at or below the maximum. `[10000, 4000]` is rejected
rather than quietly sorted — one of those two numbers is wrong and only you know
which.

Raising these makes a run gentler and slower; nine accounts at the defaults is
roughly a couple of minutes of pausing. Delays are interruptible, so Ctrl+C
during a ten-second pause stops then and there. What pacing is *not* for is
covered in `README.md` under "Looking human".

## Each account

| Field         | Type                  | Notes |
| ------------- | --------------------- | ----- |
| `label`       | string                | Short human label. It also becomes part of the output filename (lowercased, non-alphanumerics collapsed to single dashes), so changing it changes filenames. |
| `lastFour`    | string, 4 digits      | Last four of the account or card. Kept as a string because leading zeros matter (`0913`). |
| `kind`        | `"bank" \| "credit"`  | Only used for reporting today; bank and card exports differ enough that a downstream reader may care. |
| `accountLink` | string                | Selector or link text that reaches the account's page from the EasyWeb home. Playwright selector syntax, so `text=Expense Account` works as well as a CSS selector. |
| `exportSteps` | array of steps        | The clicks that trigger the CSV download, in order. The **last** step is the one expected to start the download; the tool arms its download listener around the whole sequence, so an extra confirmation click after it is fine. |

## Each export step

| Field      | Type   | Notes |
| ---------- | ------ | ----- |
| `action`   | enum   | `click`, `selectOption`, `fill`, `check`, or `waitFor`. Read/export interactions only — there is no action that could move money. |
| `selector` | string | Playwright selector. |
| `value`    | string | Required for `selectOption` and `fill`, ignored otherwise. For a date-range dropdown this is the option value or visible label. |

## Output filename contract

```
TD-<label-slug>-<lastFour>-<YYYY-MM-DD>.csv
```

`label-slug` is `label` lowercased with every run of non-alphanumeric
characters collapsed to a single dash and leading/trailing dashes trimmed. The
date is today's **local** date. So `Expense Account` / `6016` becomes
`TD-expense-account-6016-2026-09-18.csv`.

Another component reads these files by name, so treat the shape as fixed. A
same-day re-run overwrites its own files; files from other days are never
touched.
