#!/usr/bin/env bash
#
# Fails unless an exported Developer ID app can update itself with Sparkle
# (SOK-1328, ADR 0053). A build that misses any of these still builds,
# notarizes and opens, and then never learns about another release.
#
#   SPARKLE_ED_PUBLIC_KEY=<base64> apps/apple/scripts/check-exported-app.sh <Sokosumi.app>
#
# `Publish macOS DMG` runs it on the exported app with the repository variable
# SPARKLE_ED_PUBLIC_KEY. Run it on a local Release build the same way.

set -euo pipefail

APP="${1:?usage: check-exported-app.sh <Sokosumi.app>}"
EXPECTED_KEY="${SPARKLE_ED_PUBLIC_KEY:?SPARKLE_ED_PUBLIC_KEY is not set}"
FEED_URL="https://github.com/masumi-network/sokosumi/releases/download/macos-latest/appcast.xml"

PLIST="$APP/Contents/Info.plist"
SPARKLE="$APP/Contents/Frameworks/Sparkle.framework"
failures=0

fail() {
  echo "::error::$1"
  failures=$((failures + 1))
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null || true
}

[[ -d "$SPARKLE/Versions/B/XPCServices/Installer.xpc" ]] \
  || fail "Sparkle.framework with its Installer.xpc is not embedded in $APP"
otool -L "$APP/Contents/MacOS/Sokosumi" | grep -q '@rpath/Sparkle.framework' \
  || fail "the Sokosumi executable does not link Sparkle.framework"

[[ "$(plist_value SUFeedURL "$PLIST")" == "$FEED_URL" ]] \
  || fail "SUFeedURL is not $FEED_URL"
[[ "$(plist_value SUPublicEDKey "$PLIST")" == "$EXPECTED_KEY" ]] \
  || fail "SUPublicEDKey does not equal the repository variable SPARKLE_ED_PUBLIC_KEY"
[[ "$(plist_value SUEnableInstallerLauncherService "$PLIST")" == "true" ]] \
  || fail "SUEnableInstallerLauncherService is not true, so a sandboxed app cannot install an update"

ENTITLEMENTS="$(mktemp)"
trap 'rm -f "$ENTITLEMENTS"' EXIT
codesign -d --entitlements - --xml "$APP" > "$ENTITLEMENTS" 2>/dev/null
[[ "$(plist_value com.apple.security.app-sandbox "$ENTITLEMENTS")" == "true" ]] \
  || fail "the app is not sandboxed"
BUNDLE_ID="$(plist_value CFBundleIdentifier "$PLIST")"
MACH_LOOKUP="$(plist_value com.apple.security.temporary-exception.mach-lookup.global-name "$ENTITLEMENTS")"
for service in "$BUNDLE_ID-spks" "$BUNDLE_ID-spki"; do
  grep -qx "[[:space:]]*$service" <<<"$MACH_LOOKUP" \
    || fail "the mach-lookup exception for $service is missing from the signed entitlements"
done

codesign --verify --deep --strict "$APP" || fail "the app's signature does not verify"

if ((failures > 0)); then
  echo "$failures Sparkle check(s) failed for $APP" >&2
  exit 1
fi
echo "$APP can update itself with Sparkle."
