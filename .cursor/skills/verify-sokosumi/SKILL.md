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

- Node **24.x** on `PATH` (`node -v`)
- `pnpm install` already done
- Workspace packages built at least once (`pnpm packages:build`) — Core imports compiled `@sokosumi/utils` / `@sokosumi/database` exports
- `apps/web/.env` and `apps/core/.env` present (copy from `.env.example` if missing). **Do not leave angle-bracket placeholders** (`<your-…>`) — Zod rejects them. Use non-empty dummies that pass validation (see AGENTS.md cloud notes): `POSTMARK_FROM_EMAIL` = valid email; `HERMES_ORCH_BASE_URL` = valid URL; Ably keys any non-empty string; Blob/Postmark/OAuth secrets any non-empty dummy. **Optional URL fields** (`AGENT_HIRED_WEBHOOK`, Sentry DSN, etc.) must be omitted/commented out or set to a real URL — a bare `dummy` string fails `z.url()` and crashes Web after Ready.
- **`COMPOSIO_API_KEY`**: Core Zod allows omitting it, but if set it **must start with `ak_`**. A dummy like `dummy-composio-api-key` fails boot (`Invalid string: must start with "ak_"`). Use `ak_…` dummy or comment/remove the key
- `APP_SIGNING_SECRET` (web) equals `BETTER_AUTH_SECRET` (core)
- **`BETTER_AUTH_COOKIE_DOMAIN` must be unset / commented out for localhost.** Core `.env.example` sets `BETTER_AUTH_COOKIE_DOMAIN="sokosumi.com"` for production-shaped deploys — if that value is copied into local `.env`, session cookies are scoped to `.sokosumi.com` and **email/password login appears to succeed but the browser never keeps a session on `localhost`**. `doctor` fails when this trap is present
- Database reachable (Neon agent branch, or local Postgres). Prefer `with-db.mjs` when an agent branch is provisioned. Run `node scripts/cloud-agent-db/provision.mjs` when `NEON_API_KEY` + `NEON_PROJECT_ID` are set and `.cursor/cloud-agent-db.env` is missing
- `agent-browser` on `PATH` (global `npm i -g agent-browser` then `agent-browser install` for Chromium). Not a workspace dependency

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

Doctor also prints `fixture_auth=ok|fail` (Core `POST /auth/sign-in/email` for `alice@sokosumi.test`) and whether `agent-browser` is on `PATH`. Fixture failure is a **warn** (local DB may lack seeds) — not a doctor fail. On cloud-agent Neon branches, expect `fixture_auth=ok` before driving.

Optional Core-only smoke:

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi core-smoke
```

## Sign-in (cloud agents: use the harness)

Prefer the helper over hand-rolled browser clicks. It probes fixtures, drives UI Enter-submit, and falls back to Core cookie bootstrap (parses `Set-Cookie` from `POST /auth/sign-in/email`, then `agent-browser cookies set` with `HttpOnly` + `SameSite=Lax` on `localhost` — raw `cookies set --curl` often hits CDP “Invalid cookie fields” on Better Auth cookies):

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
.cursor/skills/verify-sokosumi/bin/verify-sokosumi doctor   # require doctor ok + fixture_auth=ok on agent DBs
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in  # alice@sokosumi.test / Password123!
# or: … sign-in --admin
# or: … sign-in --method cookie   # skip flaky UI; unlock rest of map
# or: … sign-in --method ui       # UI-only (no cookie fallback)
```

Artifacts land under `.cursor/verify-sokosumi-artifacts/sign-in/` (`after-login.snapshot.txt`, `account.txt`, `method.txt`). Cookie-only unlocks later features — for `signin-submit` proof, require `--method ui` (or `auto` that succeeded with `method=ui`).

## Drive

Harness: **agent-browser** (see `.agents/skills/agent-browser/SKILL.md` and `apps/web/AGENTS.md` Browser Automation). No Playwright/Cypress in this repo.

Cloud Agent **computer-use** (GUI browser subagent) is a fallback when `agent-browser` is unavailable — **same auth and env rules apply**. Prefer agent-browser / `verify-sokosumi sign-in`. Computer-use pitfalls (live-proved): Magic Link’s email field sits above the password form; JS `value=` does not satisfy react-hook-form (type keys); Chrome “Save password?” after login steals clicks — dismiss it. Full recipe in [sign-in.md](./features/sign-in.md).

Session reuse:

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
```

Stable auth selectors: `[data-testid="auth-field-email"]`, `[data-testid="auth-field-currentPassword"]`, `[data-testid="auth-submit"]`.

**Login rule (manual drive):** fill email/password fields only, then **press Enter** — do not click submit, Google, Microsoft, Passkey, or Magic Link. react-hook-form can race a programmatic click; social/passkey controls sit **above** the password form and steal automation focus.

If UI login leaves you on `/signin` or bounces back after a “success” (classic `BETTER_AUTH_COOKIE_DOMAIN` trap, or passkey/OAuth interference), fix env first, then `verify-sokosumi sign-in --method cookie` (see [sign-in.md](./features/sign-in.md)). API bootstrap alone is not UI proof — reopen a protected page in the browser after injecting cookies.

Credentials (pick one):

| Source | Email | Password | When |
| --- | --- | --- | --- |
| Cloud-agent fixtures | `alice@sokosumi.test` | `Password123!` | Neon `cloud-agent-*` branches after migrate/seed |
| Cloud-agent admin | `admin@sokosumi.test` | `Password123!` | Admin UI `/admin` |
| Local signup | unique `*@sokosumi.test` via `/signup` | choose once | Empty/local DB without fixtures |
| Coworker vault | `agent-browser auth save sokosumi …` | machine-local | Personal accounts — never commit |

OAuth, magic-link, and passkey do **not** work with placeholder credentials. Skip those paths.

API drive (secondary): `curl` against Core with session cookies from the browser when needed; public smoke is OpenAPI JSON only.

## Evidence

Root: `.cursor/verify-sokosumi-artifacts/` (gitignored). Keep proofs; cleanup must not delete them.

Per feature, under `.cursor/verify-sokosumi-artifacts/<feature-id>/`:

- Screenshot(s) with app chrome visible. `agent-browser screenshot` writes under `~/.agent-browser/tmp/screenshots/` — copy the newest file into the feature artifact dir. Prefer **no path argument** then `cp` (passing a destination path can yield a blank image in some agent-browser versions).
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
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in
.cursor/skills/verify-sokosumi/bin/verify-sokosumi core-smoke
.cursor/skills/verify-sokosumi/bin/verify-sokosumi cleanup
```

Env overrides: `VERIFY_SOKOSUMI_WEB_URL`, `VERIFY_SOKOSUMI_CORE_URL`, `VERIFY_SOKOSUMI_STATE_DIR`, `VERIFY_SOKOSUMI_ARTIFACT_ROOT`, `VERIFY_SOKOSUMI_EMAIL`, `VERIFY_SOKOSUMI_PASSWORD`.

## Isolate

Default ports **3000** (web) and **8787** (core) are shared. Second concurrent verify run on the same machine is **not** supported without changing ports and env URLs — helper refuses if ports already answer. Cloud agents get an isolated Neon branch per conversation; still one web+core pair per verify run.

## Gotchas (always)

- Ambient `DATABASE_URL` can override `.env` — use `with-db.mjs` when `.cursor/cloud-agent-db.env` exists
- **`BETTER_AUTH_COOKIE_DOMAIN=sokosumi.com` (or any production domain) on localhost** → cookies never stick; disable it before blaming the form
- Copying `.env.example` without replacing `<…>` placeholders → Core/Web fail Zod at boot (“missing env”)
- Optional URL env vars (`AGENT_HIRED_WEBHOOK`, Sentry DSN) set to non-URL dummies → Web crashes after Ready (`z.url()`); omit or use a real URL
- `COMPOSIO_API_KEY` set without an `ak_` prefix → Core refuses to start (optional key; omit or use `ak_…`)
- Empty local catalog: `/agents` soft-empty (“No agents available”) or Core 500 until `credit_cost` rows exist
- Ably placeholders break realtime chat UI
- Fixtures exist only on agent Neon branches, not production/`main`
- Node **24.x** required
- `/signin` shows Google / Microsoft / Passkey / Magic Link **above** the password form — automation must target `[data-testid="auth-field-*"]` only
