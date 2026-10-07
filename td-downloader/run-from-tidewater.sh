#!/usr/bin/env bash
#
# The two halves of the monthly run, for the "Tidewater TD Download" Shortcut
# that Tidewater's "Download from TD" button opens (Mac only):
#
#   ./run-from-tidewater.sh start-chrome   open the bank Chrome window (if it isn't already)
#   ./run-from-tidewater.sh download       run the downloader in a Terminal window you can watch
#
# The Shortcut runs start-chrome, then shows an alert asking you to log into
# EasyWeb by hand, then runs download. Nothing here sees or types a password:
# the login stays yours, exactly as with ./launch-chrome.sh and npm run download.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${TD_CDP_PORT:-9222}"

case "${1:-}" in
  start-chrome)
    if curl -fs "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
      echo "The bank Chrome window is already open."
      exit 0
    fi
    mkdir -p "$HERE/runs"
    # Detached, so the Shortcut can move on to its "log in, then Continue" alert.
    nohup "$HERE/launch-chrome.sh" >"$HERE/runs/chrome.log" 2>&1 &
    for _ in $(seq 1 30); do
      curl -fs "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1 && exit 0
      sleep 0.5
    done
    echo "Chrome did not open its debugging port. See $HERE/runs/chrome.log"
    exit 1
    ;;
  download)
    # Terminal, not the Shortcut, runs the download: the per-account progress
    # stays visible, and Ctrl+C works as usual.
    osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd " & quoted form of "$HERE" & " && npm run download"
end tell
APPLESCRIPT
    ;;
  *)
    echo "usage: $0 start-chrome | download" >&2
    exit 2
    ;;
esac
