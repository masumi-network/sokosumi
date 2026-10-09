#!/usr/bin/env bash
#
# Prints a Stable release's update notes: its section of the changelog Release
# Please writes, then a link to the GitHub release (SOK-1329). Sparkle shows
# them in the update prompt; `Publish macOS DMG` embeds them in the appcast and
# check-appcast.sh expects exactly this text.
#
#   apps/apple/scripts/release-notes.sh apps/apple/CHANGELOG.md 1.0.0

set -euo pipefail

CHANGELOG="${1:?usage: release-notes.sh <CHANGELOG.md> <version>}"
VERSION="${2:?usage: release-notes.sh <CHANGELOG.md> <version>}"

# A section runs from `## [1.1.0](compare link) (date)`, or `## 1.0.0 (date)`
# for the first release, to the next `## ` heading. Blank edges are dropped.
section="$(
  awk -v version="$VERSION" '
    /^## / {
      if (found) exit
      heading = $2
      gsub(/^\[|\].*$/, "", heading)
      found = heading == version
      next
    }
    found && NF { last = NR }
    found && (NF || started) { started = 1; lines[NR] = $0 }
    END { for (n = 1; n <= last; n++) if (n in lines) print lines[n] }
  ' "$CHANGELOG" 2> /dev/null
)" || true

if [[ -z "$section" ]]; then
  echo "::error::$CHANGELOG has no section for $VERSION" >&2
  exit 1
fi

printf '%s\n\n[Release on GitHub](https://github.com/masumi-network/sokosumi/releases/tag/macos-v%s)\n' \
  "$section" "$VERSION"
