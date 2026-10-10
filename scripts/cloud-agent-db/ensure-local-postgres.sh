#!/usr/bin/env bash
# Local Postgres fallback when Neon agent-branch secrets are absent.
# Skips when provision.mjs wrote .cursor/cloud-agent-db.urls.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

if [[ -f "${ROOT}/.cursor/cloud-agent-db.urls.json" ]]; then
  echo "[cloud-agent] Neon agent database present; skipping local Postgres"
  exit 0
fi

if ! dpkg -s postgresql-16 >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16 postgresql-client-16
fi

sudo pg_ctlcluster 16 main start || true
ready=0
for _ in $(seq 1 30); do
  if sudo pg_isready -q; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  echo "[cloud-agent] local Postgres did not become ready" >&2
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sokosumi') THEN
    CREATE ROLE sokosumi LOGIN PASSWORD 'sokosumi';
  ELSE
    ALTER ROLE sokosumi WITH LOGIN PASSWORD 'sokosumi';
  END IF;
END
$$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'core'" | grep -qx 1; then
  sudo -u postgres createdb -O sokosumi core
fi

export DATABASE_URL="postgresql://sokosumi:sokosumi@localhost:5432/core?schema=public"
export DATABASE_URL_UNPOOLED="${DATABASE_URL}"

node scripts/local-env/bootstrap.mjs
# CMO has no database. Point it at this checkout's Core so `pnpm dev` can boot.
# OAuth sign-in still needs a registered client; the dummies only satisfy env.
CMO_ENV="${ROOT}/apps/cmo/.env"
if [[ ! -f "${CMO_ENV}" ]]; then
  cat > "${CMO_ENV}" <<'EOF'
BETTER_AUTH_URL="http://localhost:3100"
BETTER_AUTH_SECRET="TFVfK91TGv2YVyVYFk0lu87Md5a13E4l7AjEaoZD8dQ="
CORE_APP_BASE_URL="http://localhost:8787"
SOKOSUMI_OAUTH_CLIENT_ID="local-cmo"
SOKOSUMI_OAUTH_CLIENT_SECRET="local-cmo-secret"
SOKOSUMI_APP_BASE_URL="http://localhost:3000"
EOF
fi
bash scripts/cloud-agent-db/ensure-pnpm.sh prisma:migrate:deploy
bash scripts/cloud-agent-db/ensure-pnpm.sh prisma:generate
echo "[cloud-agent] local Postgres ready (${DATABASE_URL})"
