#!/usr/bin/env bash
# Cursor Cloud Agent start: local Postgres when no Neon branch, then web+core+cmo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export PATH="/usr/local/cargo/bin:${PATH}"

# Install runs on the build pod, where CURSOR_AGENT is unset, so provision
# there is a no-op. Each agent boot is the run that can fork a Neon branch.
node scripts/cloud-agent-db/provision.mjs

if [[ ! -f "${ROOT}/.cursor/cloud-agent-db.urls.json" ]]; then
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
  export DATABASE_URL="postgresql://sokosumi:sokosumi@localhost:5432/core?schema=public"
  export DATABASE_URL_UNPOOLED="${DATABASE_URL}"
fi

exec node scripts/cloud-agent-db/with-db.mjs -- bash scripts/cloud-agent-db/ensure-pnpm.sh dev
