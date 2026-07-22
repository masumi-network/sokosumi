#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Prepares the Sokosumi monorepo so linters, type checks, and tests work:
#   1. Ensures Node 24.x (the repo's required runtime) via nvm.
#   2. Activates pnpm (pinned by the root package.json "packageManager" field).
#   3. Installs dependencies. `pnpm install` triggers each workspace's
#      `prepare` script, which generates the Prisma clients and builds the
#      shared packages (@sokosumi/database, /masumi, /utils, ...).
#
# Idempotent and non-interactive: safe to re-run. Node 24 install is skipped
# when already present. Runs only in the remote (web) environment.
set -euo pipefail

# Only run in Claude Code on the web; local machines manage their own toolchain.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Load nvm. The nvm shell function is only defined in login/interactive
# shells, so a non-interactive hook shell must source nvm.sh directly. Try the
# known locations in order (the web container ships it under /opt/nvm).
#
# nvm.sh is not strict-mode-safe: it references unset vars and returns non-zero
# while auto-selecting the default version on source. Relax -e/-u around nvm so
# those benign returns do not abort the hook, then restore strict mode.
set +eu
for _nvm_sh in \
  "${NVM_DIR:-}/nvm.sh" \
  "/opt/nvm/nvm.sh" \
  "/etc/profile.d/nvm.sh" \
  "$HOME/.nvm/nvm.sh"; do
  if [ -n "$_nvm_sh" ] && [ -s "$_nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$_nvm_sh"
    break
  fi
done

if ! command -v nvm >/dev/null 2>&1; then
  echo "session-start hook: nvm not found; cannot select Node 24." >&2
  exit 1
fi

# Ensure Node 24.x. `nvm install` is a no-op if it is already present.
nvm install 24 >/dev/null
nvm use 24 >/dev/null
set -eu

# Persist the Node 24 bin dir on PATH for the rest of the session so the
# agent's shells resolve node/pnpm 24 instead of the container default (Node 22).
NODE_BIN_DIR="$(dirname "$(nvm which 24)")"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$NODE_BIN_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
export PATH="$NODE_BIN_DIR:$PATH"

# Activate the pnpm version pinned by package.json "packageManager".
corepack enable >/dev/null 2>&1 || true

echo "Node: $(node -v) | pnpm: $(pnpm -v)"

# Install workspace dependencies. `prepare` scripts generate Prisma clients
# and build the shared packages as part of this step.
pnpm install

echo "Sokosumi session-start hook complete."
