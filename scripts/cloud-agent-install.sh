#!/usr/bin/env bash
# Cloud Agent / environment-build install.
#
# pnpm 12 ships a native binary. The npm tarball's `pnpm` file is a shebang-less
# placeholder that `install.js` replaces. Corepack skips lifecycle scripts, and
# pnpm's tools cache at ~/.local/share/pnpm/.tools/pnpm/<ver> can keep that
# placeholder. Executing it with /bin/sh fails:
#   /home/ubuntu/.local/share/pnpm/.tools/pnpm/12.1.0/bin/pnpm: 4: Syntax error: ")" unexpected
# Corepack's own entry downloads the native binary. Always install through it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PACKAGE_MANAGER="$(node -p "require('./package.json').packageManager")"
if [[ ! "$PACKAGE_MANAGER" =~ ^pnpm@ ]]; then
  echo "cloud-agent-install: expected packageManager pnpm@*, got ${PACKAGE_MANAGER}" >&2
  exit 1
fi

corepack enable
corepack prepare "$PACKAGE_MANAGER" --activate
rm -rf "${HOME}/.local/share/pnpm/.tools/${PACKAGE_MANAGER/@/\/}"

corepack pnpm install
node scripts/cloud-agent-db/provision.mjs
