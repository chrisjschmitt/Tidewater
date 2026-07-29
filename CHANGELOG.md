# Changelog

Versions follow [semver](https://semver.org): **MAJOR.MINOR.PATCH**.
Release notes start here — earlier work lived in the initial 0.1.0 commit without a changelog.

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
