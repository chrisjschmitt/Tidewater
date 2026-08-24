# Changelog

## 0.4.0 — 2026-08-24

### Added
- Forecast tab (inside unlocked expense tracking): household goal coverage at a 9-of-10 bar, sealed monthly snapshots, and last-month variance with a reconstructed label when no snapshot was stored

## 0.3.4 — 2026-07-30

### Fixed
- Transaction import review appears immediately on the welcome screen (it used to wait until a budget was already open)

## 0.3.3 — 2026-07-30

### Added
- Progress bar while importing large files (reading, then averaging Monarch transactions)

## 0.3.2 — 2026-07-30

### Added
- Desktop / home-screen icon set (PNG + Apple touch icon + macOS `.icns`)
- Installable Mac app at `dist-native/Tidewater.app` (`npm run app:mac`) — opens the live PWA in an app window
- Stronger PWA manifest for installing Tidewater on Mac and iPad

## 0.3.1 — 2026-07-29

### Added
- **Restore a full backup** under Your data (JSON), so export and restore sit together; welcome Import also accepts `.json`

## v0.3.0 — 2026-07-29

- CR-16: Add a help feature

Versions follow [semver](https://semver.org): **MAJOR.MINOR.PATCH**.
Release notes start here — earlier work lived in the initial 0.1.0 commit without a changelog.

## 0.2.4 — 2026-07-29

### Added
- Help button in the header and a dedicated Help modal with guidance on budget setup, expense sliders, goals, CSV/Monarch importing, chat assistant, and data privacy

## 0.2.3 — 2026-07-29

### Added
- Chat history is kept on this device (IndexedDB) and restored when you reopen the assistant; **Clear** removes it, and **Erase my data** clears it with the budget

## 0.2.2 — 2026-07-29

### Fixed
- A blank-looking page after a hard reload: if the browser's storage does not answer, Tidewater now opens anyway after a few seconds and says that nothing will be saved, instead of waiting forever on “Opening your budget…”

## 0.2.1 — 2026-07-29

### Added
- Version number after the Tidewater name; tap or click it to read this changelog

## 0.2.0 — 2026-07-29

### Added
- Custom goals via **Something else**: name the goal, then add it to the list
- Version tracking (`package.json`, `CHANGELOG.md`, shown under Your data)

### Fixed / improved (carried from 0.1.x work)
- Per-goal time scales (1 / 5 / 10 / 25 / 35 years), two cards side-by-side
- Stable expense slider baselines and whole-dollar amount entry (no leading-zero glitch)
- Goal contribution/rate steppers with direct entry
- Recommended Anthropic models with relative cost guidance
