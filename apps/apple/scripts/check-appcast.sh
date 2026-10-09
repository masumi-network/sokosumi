#!/usr/bin/env bash
#
# Fails unless a signed appcast offers exactly this disk image as the app's
# Stable release, so every installed build accepts it (SOK-1329, ADR 0054):
# its EdDSA signature verifies against the public key shipped apps carry, its
# length is the disk image's, its URL is the immutable macos-v<version> asset,
# its versions are the app's, and its notes are that version's changelog
# section with the release link (release-notes.sh).
#
#   SPARKLE_ED_PUBLIC_KEY=<base64> apps/apple/scripts/check-appcast.sh \
#     <appcast.xml> <Sokosumi.dmg> <Sokosumi.app> <CHANGELOG.md>
#
# `Publish macOS DMG` runs it on the appcast generate_appcast wrote, with the
# repository variable SPARKLE_ED_PUBLIC_KEY. test-check-appcast.sh covers it.

set -euo pipefail

usage="usage: check-appcast.sh <appcast.xml> <Sokosumi.dmg> <Sokosumi.app> <CHANGELOG.md>"
APPCAST="${1:?$usage}"
DMG="${2:?$usage}"
APP="${3:?$usage}"
CHANGELOG="${4:?$usage}"
PUBLIC_KEY="${SPARKLE_ED_PUBLIC_KEY:?SPARKLE_ED_PUBLIC_KEY is not set}"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
failures=0

fail() {
  echo "::error::$1"
  failures=$((failures + 1))
}

xpath() {
  xmllint --xpath "$1" "$APPCAST" 2> /dev/null || true
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Contents/Info.plist" 2> /dev/null || true
}

[[ "$(xpath 'count(//item)')" == 1 ]] \
  || fail "$APPCAST must hold exactly one item, the Stable release"

BUILD="$(plist_value CFBundleVersion)"
VERSION="$(plist_value CFBundleShortVersionString)"
URL="https://github.com/masumi-network/sokosumi/releases/download/macos-v$VERSION/Sokosumi.dmg"
item='//item[1]'
enclosure="$item/enclosure"

[[ "$(xpath "string($enclosure/@url)")" == "$URL" ]] \
  || fail "the enclosure URL is not $URL"
[[ "$(xpath "string($enclosure/@length)")" == "$(stat -f%z "$DMG")" ]] \
  || fail "the enclosure length is not the size of $DMG"
[[ "$(xpath "string($item/*[local-name()='version'])")" == "$BUILD" ]] \
  || fail "sparkle:version is not the app's build number $BUILD"
[[ "$(xpath "string($item/*[local-name()='shortVersionString'])")" == "$VERSION" ]] \
  || fail "sparkle:shortVersionString is not the app's version $VERSION"

if notes="$("$SCRIPTS/release-notes.sh" "$CHANGELOG" "$VERSION")"; then
  [[ "$(xpath "string($item/description)")" == "$notes" ]] \
    || fail "the description is not the $VERSION changelog section with the release link"
else
  fail "the description cannot be checked without a $VERSION changelog section"
fi

signature="$(xpath "string($enclosure/@*[local-name()='edSignature'])")"
swift "$SCRIPTS/verify-sparkle-signature.swift" "$PUBLIC_KEY" "${signature:-missing}" "$DMG" \
  || fail "the enclosure's EdDSA signature does not verify against SPARKLE_ED_PUBLIC_KEY for $DMG"

if ((failures > 0)); then
  echo "$failures appcast check(s) failed for $APPCAST" >&2
  exit 1
fi
echo "$APPCAST offers $DMG as $VERSION ($BUILD), signed with the shipped key."
