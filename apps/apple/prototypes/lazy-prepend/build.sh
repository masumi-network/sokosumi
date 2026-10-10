#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="${1:-/tmp/swiftui-prepend-reproduction}"
app="$output_dir/ScrollReproduction.app"
mkdir -p "$app/Contents/MacOS"
xcrun swiftc -parse-as-library -O -g -swift-version 6 -target arm64-apple-macos26.0 \
  "$source_dir/ScrollReproduction.swift" -o "$app/Contents/MacOS/ScrollReproduction"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.sokosumi.swiftui-prepend-reproduction</string>
<key>CFBundleExecutable</key><string>ScrollReproduction</string>
<key>CFBundleName</key><string>ScrollReproduction</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
cat > "$output_dir/Profile.entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>
PLIST
codesign --force --options runtime --timestamp=none \
  --entitlements "$output_dir/Profile.entitlements" \
  --sign 'Developer ID Application: utxo AG (GVWN7HXYJB)' "$app"
codesign --verify --strict "$app"
codesign -dv "$app" 2>&1
printf '%s\n' "$app"
