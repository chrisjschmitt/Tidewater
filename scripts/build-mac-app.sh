#!/usr/bin/env bash
# Build a double-clickable Tidewater.app for macOS.
# Opens the live PWA in an app window (Chrome/Edge/Brave) or Safari.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${1:-$ROOT/dist-native/Tidewater.app}"
URL="${TIDEWATER_URL:-https://tidewater-one.vercel.app}"
ICNS="$ROOT/native/mac/AppIcon.icns"

if [[ ! -f "$ICNS" ]]; then
  echo "Missing $ICNS — run: npm run icons:mac" >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$ICNS" "$APP_DIR/Contents/Resources/AppIcon.icns"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Tidewater</string>
  <key>CFBundleDisplayName</key>
  <string>Tidewater</string>
  <key>CFBundleIdentifier</key>
  <string>app.tidewater.desktop</string>
  <key>CFBundleVersion</key>
  <string>0.3.2</string>
  <key>CFBundleShortVersionString</key>
  <string>0.3.2</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>Tidewater</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$APP_DIR/Contents/MacOS/Tidewater" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
URL="${TIDEWATER_URL:-https://tidewater-one.vercel.app}"

open_chrome_family() {
  local app="$1"
  if [[ -d "/Applications/${app}.app" ]] || [[ -d "$HOME/Applications/${app}.app" ]]; then
    open -na "$app" --args --app="$URL" --new-window
    return 0
  fi
  return 1
}

if open_chrome_family "Google Chrome"; then
  exit 0
fi
if open_chrome_family "Microsoft Edge"; then
  exit 0
fi
if open_chrome_family "Brave Browser"; then
  exit 0
fi
if open_chrome_family "Chromium"; then
  exit 0
fi

# Safari fallback — opens the site; use File → Add to Dock for a true PWA window.
open -a Safari "$URL"
LAUNCH

chmod +x "$APP_DIR/Contents/MacOS/Tidewater"

# Drop a Finder-friendly copy beside the project when building the default path.
echo "Built $APP_DIR"
echo "URL:   $URL"
echo "Drag Tidewater.app to /Applications or your Dock."
