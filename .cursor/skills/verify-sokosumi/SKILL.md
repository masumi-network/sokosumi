---
name: verify-sokosumi
description: Drive the Sokosumi web app (and Core API) the way a user does — launch local web+core, doctor health, browser login via agent-browser, capture proof. Use when proving a UI/API change works, after feature work, or when a task needs end-to-end evidence beyond unit tests.
---

# Verify Sokosumi

Project-local verification for agents that have never seen this app. Primary surface is the **web UI** at `:3000`. Secondary surface is the **Core API** at `:8787` (OpenAPI / curl). Web never talks to Postgres directly — Core owns the DB.

Read `features/README.md` before driving. Use a matching feature file as the recipe. Prefer `agent-browser` over inventing selectors.

## Launch

Prefer **`http://localhost:3000`** / **`http://localhost:8787`** (not `127.0.0.1`) so Better Auth origin checks and cookies match `WEB_APP_BASE_URL` / `BETTER_AUTH_URL`.

Ready when:

- Core answers `GET http://localhost:8787/v1/openapi.json` with 2xx
- Web answers `GET http://localhost:3000/signin` with 2xx

Preconditions before launch:

- `pnpm install` already done
- `apps/web/.env` and `apps/core/.env` present (copy from `.env.example` if missing)
- `APP_SIGNING_SECRET` (web) equals `BETTER_AUTH_SECRET` (core)
- Database reachable (Neon agent branch, or local Postgres). Prefer `with-db.mjs` when an agent branch is provisioned.

### Cursor agent session (required pattern)

Short-lived agent shells often SIGHUP children when the launch command exits. Start Core and Web as **background jobs that stay alive**, then write the wrapper PIDs into the state file:

```bash
# background: pnpm core:dev
# background: pnpm web:dev
mkdir -p .cursor/verify-sokosumi-artifacts/state
printf 'core=%s\nweb=%s\nstarted_at=%s\nweb_url=http://localhost:3000\ncore_url=http://localhost:8787\n' \
  "<core-shell-pid>" "<web-shell-pid>" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > .cursor/verify-sokosumi-artifacts/state/dev.pids
```

If `.cursor/cloud-agent-db.env` exists, wrap with `node scripts/cloud-agent-db/with-db.mjs -- pnpm core:dev` (same for web).

### Durable human terminal

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi launch
```

Helper starts `pnpm core:dev` and `pnpm web:dev` via `nohup`. If `.cursor/cloud-agent-db.env` exists, both are wrapped with `with-db.mjs`.

Teardown:

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi cleanup
```

For Cursor background shells, kill those shell PIDs (or stop the terminal jobs) after cleanup if the helper did not own them.

## Doctor

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi doctor
```

Require `doctor ok`. If `owned_by_verify=no`, do **read-only** checks only — never mutate a foreign instance. If ports already answer before `launch`, the helper refuses (no double-drive).

Optional Core-only smoke:

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi core-smoke
```

## Drive

Harness: **agent-browser** (see `.agents/skills/agent-browser/SKILL.md` and `apps/web/AGENTS.md` Browser Automation). No Playwright/Cypress in this repo.

Session reuse:

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
```

Stable auth selectors: `[data-testid="auth-field-email"]`, `[data-testid="auth-field-currentPassword"]`, `[data-testid="auth-submit"]`.

**Login rule:** fill fields, then **press Enter** — do not rely on clicking submit. react-hook-form can race a programmatic click.

Credentials (pick one):

| Source | Email | Password | When |
| --- | --- | --- | --- |
| Cloud-agent fixtures | `alice@sokosumi.test` | `Password123!` | Neon `cloud-agent-*` branches after migrate/seed |
| Cloud-agent admin | `admin@sokosumi.test` | `Password123!` | Admin UI `/admin` |
| Local signup | unique `*@sokosumi.test` via `/signup` | choose once | Empty/local DB without fixtures |
| Coworker vault | `agent-browser auth save sokosumi …` | machine-local | Personal accounts — never commit |

OAuth and magic-link do **not** work with placeholder credentials. Skip those paths.

API drive (secondary): `curl` against Core with session cookies from the browser when needed; public smoke is OpenAPI JSON only.

## Evidence

Root: `.cursor/verify-sokosumi-artifacts/` (gitignored). Keep proofs; cleanup must not delete them.

Per feature, under `.cursor/verify-sokosumi-artifacts/<feature-id>/`:

- Screenshot(s) with app chrome visible. `agent-browser screenshot` writes under `~/.agent-browser/tmp/screenshots/` — copy the newest file into the feature artifact dir.
- Interactive snapshot: `agent-browser snapshot -i > <path>.snapshot.txt`
- For API: response body + HTTP status file
- Record feature ID and entry point used. Never commit passwords; `account.txt` may store email only.

Proof standards:

- Exercise the **real user path** (browser UI or documented Core route), not test-only setters
- Capture **action + resulting state**, not only the final screen
- Confirm side effects when the feature mutates (new row visible on reload, URL change, second view)
- Chat may show an Ably error modal when keys are placeholders — that does **not** prove chat works; prove landing/redirect or non-realtime surfaces instead unless Ably is configured

## Cleanup

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi cleanup
```

Stops only pids recorded by `launch`. Never `killall node` / kill by process name. Leaves `.cursor/verify-sokosumi-artifacts/**` intact. Close the browser when done: `agent-browser close`.

## Helpers

Executable: `.cursor/skills/verify-sokosumi/bin/verify-sokosumi`

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi launch
.cursor/skills/verify-sokosumi/bin/verify-sokosumi doctor
.cursor/skills/verify-sokosumi/bin/verify-sokosumi core-smoke
.cursor/skills/verify-sokosumi/bin/verify-sokosumi cleanup
```

Env overrides: `VERIFY_SOKOSUMI_WEB_URL`, `VERIFY_SOKOSUMI_CORE_URL`, `VERIFY_SOKOSUMI_STATE_DIR`, `VERIFY_SOKOSUMI_ARTIFACT_ROOT`.

## Isolate

Default ports **3000** (web) and **8787** (core) are shared. Second concurrent verify run on the same machine is **not** supported without changing ports and env URLs — helper refuses if ports already answer. Cloud agents get an isolated Neon branch per conversation; still one web+core pair per verify run.

## Gotchas (always)

- Ambient `DATABASE_URL` can override `.env` — use `with-db.mjs` when `.cursor/cloud-agent-db.env` exists
- Empty local catalog: `/agents` or `GET /v1/agents` may fail until `credit_cost` rows exist
- Ably placeholders break realtime chat UI
- Fixtures exist only on agent Neon branches, not production/`main`
- Node **24.x** required
