#!/usr/bin/env bash
#
# Starts a headed Google Chrome with a debugging port open, so the downloader
# can attach to a session *you* authenticated by hand. The downloader never
# launches a browser itself and never sees a password, which is the whole point
# of splitting these two steps apart.
#
# A dedicated user-data-dir keeps this window away from your everyday Chrome
# profile: Chrome refuses to open a debugging port on a profile that is already
# running, and you do not want your normal browsing reachable over CDP.
#
# The flags below are deliberately minimal. This is your real Chrome, started
# normally and driven later over CDP, so `navigator.webdriver` stays false and
# there is no "Chrome is being controlled by automated test software" banner —
# not because anything is being spoofed, but because none of it is true here.
# Nothing is added to hide the connection either: no --enable-automation (which
# would announce it), no --headless, no fingerprint or stealth flags. If you add
# flags of your own, keep them in that spirit.

set -euo pipefail

PORT="${TD_CDP_PORT:-9222}"
PROFILE_DIR="${TD_PROFILE_DIR:-$HOME/.td-downloader-profile}"
CHROME="${TD_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
  echo "Could not find Google Chrome at:"
  echo "  $CHROME"
  echo "Set TD_CHROME_BIN to the Chrome binary if it lives somewhere else."
  exit 1
fi

mkdir -p "$PROFILE_DIR"

cat <<INSTRUCTIONS
Launching Google Chrome (headed) for the TD download run.

  debugging port : $PORT
  profile        : $PROFILE_DIR

Next steps, in this order:

  1. In the Chrome window that just opened, go to TD EasyWeb and log in
     BY HAND — username, password, and any MFA prompt. The downloader has no
     code path for credentials and will stop if it ever sees a login form.
  2. Leave that window open and logged in.
  3. In another terminal, from td-downloader/, run:  npm run download
  4. Watch the run. Ctrl+C stops it and leaves this Chrome window exactly as
     it is — still logged in, nothing closed, nothing navigated away.

INSTRUCTIONS

exec "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check
