#!/usr/bin/env bash
#
# Checks check-appcast.sh and release-notes.sh against hand-built appcasts,
# signed with a throwaway key, without Sparkle, a build or the network.
#
#   apps/apple/scripts/test-check-appcast.sh
#
# It also runs check-exported-app.sh on an unsigned bundle, which must fail
# naming the step rather than stopping silently.
#
# `Swift lint and format` runs it on pull requests. It never touches the real
# Sparkle key.

set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO_URL="https://github.com/masumi-network/sokosumi"
failures=0

cat > "$WORK/sign.swift" <<'SWIFT'
import CryptoKit
import Foundation

// keygen            -> "<private-b64>\n<public-b64>"
// sign <priv> <file> -> signature-b64
let args = CommandLine.arguments
if args[1] == "keygen" {
  let key = Curve25519.Signing.PrivateKey()
  print(key.rawRepresentation.base64EncodedString())
  print(key.publicKey.rawRepresentation.base64EncodedString())
} else {
  let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(base64Encoded: args[2])!)
  let data = try Data(contentsOf: URL(fileURLWithPath: args[3]))
  print(try key.signature(for: data).base64EncodedString())
}
SWIFT
if ! swiftc -O -o "$WORK/sign" "$WORK/sign.swift" 2> "$WORK/swiftc.log"; then
  cat "$WORK/swiftc.log" >&2
  echo "::error::swiftc cannot build the test signing tool" >&2
  exit 1
fi

"$WORK/sign" keygen > "$WORK/key"
"$WORK/sign" keygen > "$WORK/other-key"
PRIVATE_KEY="$(sed -n 1p "$WORK/key")"
OTHER_PRIVATE_KEY="$(sed -n 1p "$WORK/other-key")"
SPARKLE_ED_PUBLIC_KEY="$(sed -n 2p "$WORK/key")"
export SPARKLE_ED_PUBLIC_KEY

cat > "$WORK/CHANGELOG.md" <<'MD'
# Changelog

## [1.1.0](https://github.com/masumi-network/sokosumi/compare/macos-v1.0.0...macos-v1.1.0) (2026-10-20)


### Features

* **chat:** reply in threads ([abc1234](https://github.com/masumi-network/sokosumi/commit/abc1234))


### Bug Fixes

* keep the draft on sign-out ([def5678](https://github.com/masumi-network/sokosumi/commit/def5678))

## 1.0.0 (2026-10-10)


### Features

* Initial release ([0123abc](https://github.com/masumi-network/sokosumi/commit/0123abc))
MD

# What a Stable 1.1.0 item must describe, written out by hand.
NOTES_110="### Features

* **chat:** reply in threads ([abc1234](https://github.com/masumi-network/sokosumi/commit/abc1234))


### Bug Fixes

* keep the draft on sign-out ([def5678](https://github.com/masumi-network/sokosumi/commit/def5678))

[Release on GitHub]($REPO_URL/releases/tag/macos-v1.1.0)"
NOTES_100="### Features

* Initial release ([0123abc](https://github.com/masumi-network/sokosumi/commit/0123abc))

[Release on GitHub]($REPO_URL/releases/tag/macos-v1.0.0)"

APP="$WORK/Sokosumi.app"
mkdir -p "$APP/Contents"
/usr/libexec/PlistBuddy \
  -c "Add :CFBundleVersion string 8123" \
  -c "Add :CFBundleShortVersionString string 1.1.0" \
  "$APP/Contents/Info.plist" > /dev/null
DMG="$WORK/Sokosumi.dmg"
head -c 4096 /dev/urandom > "$DMG"

# appcast <out> [key=value ...]: one item for $DMG, overridable field by field.
appcast() {
  local out="$1"
  shift
  local version=8123 short=1.1.0 notes="$NOTES_110"
  local url="$REPO_URL/releases/download/macos-v1.1.0/Sokosumi.dmg"
  local length signature extra=""
  length="$(stat -f%z "$DMG")"
  signature="$("$WORK/sign" sign "$PRIVATE_KEY" "$DMG")"
  for pair in "$@"; do
    case "$pair" in
      version=*) version="${pair#*=}" ;;
      short=*) short="${pair#*=}" ;;
      notes=*) notes="${pair#*=}" ;;
      url=*) url="${pair#*=}" ;;
      length=*) length="${pair#*=}" ;;
      signature=*) signature="${pair#*=}" ;;
      extra=*) extra="${pair#*=}" ;;
    esac
  done
  cat > "$out" <<XML
<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>Sokosumi</title>
        <item>
            <title>$short</title>
            <sparkle:version>$version</sparkle:version>
            <sparkle:shortVersionString>$short</sparkle:shortVersionString>
            <description sparkle:format="markdown"><![CDATA[$notes
]]></description>
            <enclosure url="$url" length="$length" type="application/octet-stream" sparkle:edSignature="$signature"/>
        </item>$extra
    </channel>
</rss>
XML
}

pass() {
  local name="$1"
  shift
  if "$@" > "$WORK/out" 2>&1; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected success"
    sed 's/^/     /' "$WORK/out"
    failures=$((failures + 1))
  fi
}

reject() {
  local name="$1" reason="$2"
  shift 2
  if "$@" > "$WORK/out" 2>&1; then
    echo "FAIL $name: expected a failure"
    failures=$((failures + 1))
  elif ! grep -q "$reason" "$WORK/out"; then
    echo "FAIL $name: failed without naming \"$reason\""
    sed 's/^/     /' "$WORK/out"
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
}

check() {
  "$SCRIPTS/check-appcast.sh" "$1" "${2:-$DMG}" "$APP" "$WORK/CHANGELOG.md"
}

# release-notes.sh
pass "notes for 1.1.0 are its changelog section and the release link" \
  test "$("$SCRIPTS/release-notes.sh" "$WORK/CHANGELOG.md" 1.1.0)" = "$NOTES_110"
pass "notes for the first release read its unlinked heading" \
  test "$("$SCRIPTS/release-notes.sh" "$WORK/CHANGELOG.md" 1.0.0)" = "$NOTES_100"
reject "notes for a version the changelog lacks" "no section for 1.2.0" \
  "$SCRIPTS/release-notes.sh" "$WORK/CHANGELOG.md" 1.2.0

# check-appcast.sh
appcast "$WORK/good.xml"
pass "a signed appcast for the disk image" check "$WORK/good.xml"

appcast "$WORK/other-key.xml" signature="$("$WORK/sign" sign "$OTHER_PRIVATE_KEY" "$DMG")"
reject "a signature from another key" "signature does not verify" check "$WORK/other-key.xml"

cp "$DMG" "$WORK/tampered.dmg"
printf 'x' | dd of="$WORK/tampered.dmg" bs=1 seek=100 conv=notrunc 2> /dev/null
reject "a disk image changed after signing" "signature does not verify" check "$WORK/good.xml" "$WORK/tampered.dmg"

appcast "$WORK/length.xml" length=4095
reject "a length that is not the disk image's" "length" check "$WORK/length.xml"

appcast "$WORK/mutable-url.xml" url="$REPO_URL/releases/download/macos-latest/Sokosumi.dmg"
reject "an item pointing at the mutable macos-latest copy" "macos-v1.1.0" check "$WORK/mutable-url.xml"

appcast "$WORK/build.xml" version=8122
reject "a build number that is not the app's" "sparkle:version" check "$WORK/build.xml"

appcast "$WORK/short.xml" short=1.0.0
reject "a version that is not the app's" "sparkle:shortVersionString" check "$WORK/short.xml"

appcast "$WORK/old-notes.xml" notes="$NOTES_100"
reject "notes from another version's section" "description" check "$WORK/old-notes.xml"

appcast "$WORK/no-link.xml" notes="${NOTES_110%$'\n\n'*}"
reject "notes without the release link" "description" check "$WORK/no-link.xml"

appcast "$WORK/two-items.xml" extra="<item><title>beta</title></item>"
reject "an appcast with more than one item" "one item" check "$WORK/two-items.xml"

# check-exported-app.sh: an unsigned bundle must fail by name, not silently.
UNSIGNED="$WORK/Unsigned.app"
mkdir -p "$UNSIGNED/Contents/MacOS"
cp "$WORK/sign" "$UNSIGNED/Contents/MacOS/Sokosumi"
cp "$APP/Contents/Info.plist" "$UNSIGNED/Contents/Info.plist"
reject "an exported app codesign cannot read" "::error::codesign" \
  "$SCRIPTS/check-exported-app.sh" "$UNSIGNED"

if ((failures > 0)); then
  echo "$failures appcast check test(s) failed" >&2
  exit 1
fi
echo "Appcast checks behave."
