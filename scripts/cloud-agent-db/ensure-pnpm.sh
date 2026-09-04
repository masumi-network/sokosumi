#!/usr/bin/env bash
# Activate Corepack pnpm for this repo and drop broken standalone installs.
#
# pnpm 12+ under ~/.local/share/pnpm/.tools ships a native-binary placeholder
# that install.js is supposed to replace. When that postinstall does not run,
# invoking the placeholder via /bin/sh fails with:
#   Syntax error: ")" unexpected
# Environment builds were hitting that path during `pnpm install`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

PM="$(node -p "require('./package.json').packageManager")"
corepack enable
corepack prepare "${PM}" --activate
rm -rf "${HOME}/.local/share/pnpm/.tools/pnpm"
hash -r 2>/dev/null || true

exec corepack pnpm "$@"
