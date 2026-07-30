#!/usr/bin/env bash
# Rasterize the master icon into PWA PNGs and a macOS .icns.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
ASSETS="$HOME/.cursor/projects/Users-christopherschmitt-Projects-apps-TideWater/assets/tidewater-icon-1024.png"

if [[ -z "$SRC" ]]; then
  if [[ -f "$ROOT/public/icons/icon-1024.png" ]]; then
    SRC="$ROOT/public/icons/icon-1024.png"
  elif [[ -f "$ASSETS" ]]; then
    SRC="$ASSETS"
  else
    echo "Provide a 1024×1024 PNG: npm run icons -- path/to/icon.png" >&2
    exit 1
  fi
fi

mkdir -p "$ROOT/public/icons" "$ROOT/native/mac/Tidewater.iconset"
if [[ "$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")" != "$ROOT/public/icons/icon-1024.png" ]]; then
  cp "$SRC" "$ROOT/public/icons/icon-1024.png"
fi
MASTER="$ROOT/public/icons/icon-1024.png"

for s in 16 32 64 128 180 192 256 512; do
  sips -z "$s" "$s" "$MASTER" --out "$ROOT/public/icons/icon-${s}.png" >/dev/null
done

# Favicon-sized SVG companion stays as public/icon.svg (hand-tuned brand mark).
cp "$ROOT/public/icons/icon-180.png" "$ROOT/public/apple-touch-icon.png"
cp "$ROOT/public/icons/icon-32.png" "$ROOT/public/favicon-32.png"

SET="$ROOT/native/mac/Tidewater.iconset"
cp "$ROOT/public/icons/icon-16.png"   "$SET/icon_16x16.png"
cp "$ROOT/public/icons/icon-32.png"   "$SET/icon_16x16@2x.png"
cp "$ROOT/public/icons/icon-32.png"   "$SET/icon_32x32.png"
cp "$ROOT/public/icons/icon-64.png"   "$SET/icon_32x32@2x.png"
cp "$ROOT/public/icons/icon-128.png"  "$SET/icon_128x128.png"
cp "$ROOT/public/icons/icon-256.png"  "$SET/icon_128x128@2x.png"
cp "$ROOT/public/icons/icon-256.png"  "$SET/icon_256x256.png"
cp "$ROOT/public/icons/icon-512.png"  "$SET/icon_256x256@2x.png"
cp "$ROOT/public/icons/icon-512.png"  "$SET/icon_512x512.png"
cp "$ROOT/public/icons/icon-1024.png" "$SET/icon_512x512@2x.png"

iconutil -c icns "$SET" -o "$ROOT/native/mac/AppIcon.icns"
echo "Icons ready under public/icons/ and native/mac/AppIcon.icns"
