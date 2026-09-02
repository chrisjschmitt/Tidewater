# Tidewater — App Profile

Maintained knowledge for AI agents working in this repo (read automatically
by the Gemini CLI; injected into SchmittyWeather's Claude reviews). Keep it
short and factual. Durable lessons from finished CRs append under
“Lessons from CRs”.

## What this app is
Calm, abundance-minded personal budgeting PWA. Helps the owner see they
already have what they need and point surplus toward goals/debt — without
scarcity framing. **No accounts, no server, no analytics.** All personal
data stays in the browser (IndexedDB). Optional OpenAI/Anthropic keys for
chat are stored on-device only and require an explicit “leaves your device”
acknowledgement.

## Stack (verified)
- **Vite + React 18, client-only — no SSR.** `window` / IndexedDB access is
  safe without guards.
- TypeScript, Tailwind CSS 4 (`@tailwindcss/vite`), PapaParse (CSV),
  idb-keyval, vite-plugin-pwa. Charts are hand-drawn SVG (no chart lib).
- Deployed on Vercel from GitHub `main`
  (production: https://tidewater-one.vercel.app).

## Layout
- UI shell: `src/App.tsx`, `src/main.tsx`.
- Components: dashboard (`SummaryRing`, `GroupBars`, `IncomeCard`),
  group drill-in (`GroupDetail`), goals (`GoalsPanel`, `GoalChart`),
  chat (`ChatPanel`), first-run (`Onboarding`), shared `Modal` /
  `AmountInput` / `ChangelogModal`.
- Domain: `src/lib/` — `budget.ts`, `categories.ts`, `csv.ts`, `starter.ts`,
  `goals.ts`, `storage.ts`, `assistant.ts`, `models.ts`, `types.ts`,
  `format.ts`, `version.ts`.
- Optional expense tracking (`src/components/etm/`): gated by
  `__ETM_AVAILABLE__`. Unlocked ETM includes a Forecast tab and a Settings tab
  (lookback, household/vacation tags, wipe). JSON backups may include the
  encrypted vault; restore needs the same key.
- Sample budget: `public/sample/ted-budget.csv`. Import fixtures under
  `Test-Data/`. Spec + category keyword docs: `docs/`.
- Sanity scripts (esbuild → node): `scripts/check-import.ts`,
  `check-starter.ts`, `check-assistant.ts`.

## Commands
- `npm run dev` — Vite on http://localhost:5173
- `npm run typecheck` — `tsc -b --noEmit` (SW Gate-3 check)
- `npm run build` — `tsc -b && vite build` (SW Gate-3 check)
- `npm run check:import` / `check:starter` / `check:assistant` / `check:etm` /
  `check:forecast` — local sanity. `check:assistant` asserts plan-only vs
  synthetic snapshot intents; a quoted question arg still prints the answer.

## Gotchas
- **Privacy invariant:** never add a backend that stores budget data; never
  send personal data to a cloud model without the existing confirm +
  per-provider key isolation in `storage.ts`.
- Category → group mapping is keyword/order-sensitive in
  `src/lib/categories.ts` (`groupForCategory`). Full keyword lists live in
  `docs/category-mapping.md` — keep code and docs aligned.
- Local assistant (`src/lib/assistant.ts`) is **first-regex-wins**, not an
  LLM. Compound questions misfire; prefer cloud when an API key is set.
  See README “Known limitation”.
- **Version sync:** bump both `package.json` and `src/lib/version.ts`
  (`APP_VERSION`) together. SW’s release step only rewrites `package.json`
  + `CHANGELOG.md` — agents/humans must update `version.ts` in the same CR
  or right after promote.
- Tone: meditative / non-judgemental; don’t ship scarcity or shame copy.

## SchmittyWeather pipeline notes
- CR work happens on `cr/<n>-<slug>` branches; agents must never commit,
  push, or switch branches themselves.
- Checks: `typecheck` + `build`. Preview = push CR branch → Vercel;
  promote = merge to `main` + push.

## Lessons from CRs

### From CR-16 (2026-07-29)
- Help UI: `src/components/HelpModal.tsx` (static, accordion sections + search), opened from a header button in `App.tsx` and a "Help & guide" link in `Onboarding`.
- No emoji in UI copy; match `ChangelogModal`/`Modal` typography and the app's quiet visual language.
- Explanatory/help copy must be verified line-by-line against actual code (`starter.ts`, `csv.ts`, `goals.ts`, `storage.ts`) — never described from a plan draft.
- Verify header controls don't wrap at 375px when adding buttons to the header group.
