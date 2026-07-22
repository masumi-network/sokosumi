#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Bootstraps the Sokosumi monorepo so linters, type checks, tests, AND the dev
# servers work out of the box on a fresh cloud session:
#   1. Node 24.x (the repo's required runtime) via nvm + pnpm (pinned).
#   2. `pnpm install` — also generates Prisma clients and builds shared packages.
#   3. Local dev `.env` files for apps/core and apps/web (derived from the
#      committed .env.example; nothing secret, and .env stays gitignored).
#   4. Local PostgreSQL: start the cluster, ensure the sokosumi role + core DB.
#   5. `prisma migrate deploy` + seed the credit_cost table (needed so the
#      agents/categories endpoints return 200 instead of 500).
#
# Everything here uses only NON-SECRET dev values (the same public placeholders
# already committed in .env.example). Real secrets belong in the cloud
# environment's env-var config or a gitignored .claude/settings.local.json,
# never in this file.
#
# Idempotent and non-interactive: safe to re-run. Runs only in the remote (web)
# environment. Steps degrade gracefully when their tooling is unavailable.
set -euo pipefail

# Only run in Claude Code on the web; local machines manage their own toolchain.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJECT_DIR"

# Single source of truth for local dev DB connection (also used by the apps).
LOCAL_DATABASE_URL="postgresql://sokosumi:sokosumi@localhost:5432/core?schema=public"

# ---------------------------------------------------------------------------
# 1. Node 24 + pnpm
# ---------------------------------------------------------------------------
# The nvm shell function is only defined in login/interactive shells, so a
# non-interactive hook shell must source nvm.sh directly. nvm.sh is not
# strict-mode-safe (references unset vars, returns non-zero while auto-selecting
# the default version), so relax -e/-u around it, then restore strict mode.
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

nvm install 24 >/dev/null   # no-op if already installed
nvm use 24 >/dev/null
set -eu

# Persist Node 24 + the local DATABASE_URL for the rest of the session so the
# agent's shells resolve node/pnpm 24 and connect to the local DB (overriding
# any stale DATABASE_URL the platform may inject).
NODE_BIN_DIR="$(dirname "$(nvm which 24)")"
export PATH="$NODE_BIN_DIR:$PATH"
export DATABASE_URL="$LOCAL_DATABASE_URL"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$NODE_BIN_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  echo "export DATABASE_URL=\"$LOCAL_DATABASE_URL\"" >> "$CLAUDE_ENV_FILE"
fi

corepack enable >/dev/null 2>&1 || true
echo "Node: $(node -v) | pnpm: $(pnpm -v)"

# ---------------------------------------------------------------------------
# 2. Dependencies (also generates Prisma clients + builds shared packages)
# ---------------------------------------------------------------------------
pnpm install

# ---------------------------------------------------------------------------
# 3. Local dev .env files (only written when missing, to preserve manual edits)
# ---------------------------------------------------------------------------
write_core_env() {
  local target="apps/core/.env"
  [ -f "$target" ] && { echo "env: $target exists, leaving as-is"; return; }
  cp apps/core/.env.example "$target"
  # Local fixes so the Zod env schema passes and Postgres is reachable:
  sed -i 's#@sokosumi:5432/core#@localhost:5432/core#' "$target"          # DB host -> localhost
  sed -i 's#^POSTMARK_FROM_EMAIL=.*#POSTMARK_FROM_EMAIL="noreply@example.com"#' "$target"  # valid email
  sed -i 's#^HERMES_ORCH_BASE_URL=.*#HERMES_ORCH_BASE_URL="http://localhost:9999"#' "$target"  # valid URL
  sed -i 's#^BETTER_AUTH_COOKIE_DOMAIN=#\#BETTER_AUTH_COOKIE_DOMAIN=#' "$target"  # cookies on localhost
  sed -i 's#^COMPOSIO_API_KEY=#\#COMPOSIO_API_KEY=#' "$target"            # placeholder fails ak_ format
  echo "env: wrote $target"
}

write_web_env() {
  local target="apps/web/.env"
  [ -f "$target" ] && { echo "env: $target exists, leaving as-is"; return; }
  cp apps/web/.env.example "$target"
  # APP_SIGNING_SECRET must match Core BETTER_AUTH_SECRET (both public example values).
  local core_secret
  core_secret="$(grep -E '^BETTER_AUTH_SECRET=' apps/core/.env.example | cut -d= -f2- | tr -d '"')"
  sed -i "s#^APP_SIGNING_SECRET=.*#APP_SIGNING_SECRET=\"${core_secret}\"#" "$target"
  sed -i 's#^AGENT_HIRED_WEBHOOK=#\#AGENT_HIRED_WEBHOOK=#' "$target"       # placeholder not a valid URL
  echo "env: wrote $target"
}

write_core_env
write_web_env

# ---------------------------------------------------------------------------
# 4. Local PostgreSQL (start cluster + ensure role/db). Skipped if absent.
# ---------------------------------------------------------------------------
if command -v pg_ctlcluster >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
  # Start the default cluster if it is not already online.
  if command -v pg_lsclusters >/dev/null 2>&1 && ! pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
    pg_ctlcluster 16 main start 2>/dev/null || sudo pg_ctlcluster 16 main start 2>/dev/null || true
  fi

  # Ensure role + database exist (idempotent).
  sudo -u postgres psql -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL' || true
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sokosumi') THEN
    CREATE ROLE sokosumi LOGIN PASSWORD 'sokosumi' CREATEDB;
  END IF;
END$$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='core'" 2>/dev/null | grep -q 1 \
    || sudo -u postgres createdb -O sokosumi core 2>/dev/null || true

  # ---------------------------------------------------------------------------
  # 5. Migrate + seed credit_cost (needed so agents/categories return 200).
  # ---------------------------------------------------------------------------
  if PGPASSWORD=sokosumi psql -h localhost -U sokosumi -d core -c 'SELECT 1' >/dev/null 2>&1; then
    pnpm prisma:migrate:deploy >/dev/null 2>&1 || echo "db: migrate deploy failed (check logs)"

    # Seed 'lovelace' credit cost: creditsPerUnit 0.0001 * CREDITS_BASE(1e10) = 1_000_000.
    PGPASSWORD=sokosumi psql -h localhost -U sokosumi -d core -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL' || echo "db: credit_cost seed skipped"
INSERT INTO "CreditCost" (id, "createdAt", "updatedAt", unit, "centsPerUnit")
VALUES (gen_random_uuid()::text, now(), now(), 'lovelace', 1000000)
ON CONFLICT (unit) DO NOTHING;
SQL
    echo "db: ready (migrated + credit_cost seeded)"
  else
    echo "db: cannot connect as sokosumi; skipped migrate/seed"
  fi
else
  echo "db: PostgreSQL tooling not found; skipped DB bootstrap"
fi

echo "Sokosumi session-start hook complete."
