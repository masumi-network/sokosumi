#!/usr/bin/env bash
# Cursor Cloud Agent install: Node 24, pnpm install, Neon branch or local Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export PATH="/usr/local/cargo/bin:${PATH}"

bash scripts/cloud-agent-db/ensure-node24.sh
hash -r

bash scripts/cloud-agent-db/ensure-pnpm.sh install
node scripts/cloud-agent-db/provision.mjs
bash scripts/cloud-agent-db/ensure-local-postgres.sh
