---
name: verify-sokosumi
description: Drive the Sokosumi web app (and Core API) the way a user does — launch local web+core, doctor health, browser login via agent-browser, capture proof. Use when proving a UI/API change works, after feature work, or when a task needs end-to-end evidence beyond unit tests.
---

# Verify Sokosumi

Project-local verification for agents that have never seen this app. Primary surface is the **web UI** at the portless named HTTPS URL (`web_url=` from doctor). Secondary surface is the **Core API** (`core_url=` — OpenAPI / curl). Web never talks to Postgres directly — Core owns the DB.

Read `features/README.md` before driving. Use a matching feature file as the recipe. Prefer `agent-browser` over inventing selectors.

## Launch

Prefer **portless named HTTPS URLs** from `verify-sokosumi doctor` (`web_url=` / `core_url=`). Do not guess `:3000` / `:8787` — print with `pnpm portless:url web`. Linked git worktrees get a branch prefix; Grok copies get a directory basename. Classic `pnpm web:dev` still binds `:3000`.

Ready when:

- Core answers `GET $CORE_URL/v1/openapi.json` with 2xx
- Web answers `GET $WEB_URL/signin` with 2xx

Preconditions before launch:

- Node **24.x** on `PATH` (`node -v`)
- `pnpm install` already done (`portless` is a root devDependency)
- Workspace packages built at least once (`pnpm packages:build`) — Core imports compiled `@sokosumi/utils` / `@sokosumi/database` exports
- `apps/web/.env` and `apps/core/.env` present. **`verify-sokosumi launch` (and `pnpm env:bootstrap`) copy `.env.example` and sanitize placeholders.** **Do not leave angle-bracket placeholders** (`<your-…>`) — Zod rejects them. Use non-empty dummies that pass validation (see AGENTS.md cloud notes): `RESEND_API_KEY` = any non-empty string; `RESEND_FROM_EMAIL` optional (defaults to `noreply@sokosumi.com`); `HERMES_ORCH_BASE_URL` = valid URL; Ably keys any non-empty string; Blob/Resend/OAuth secrets any non-empty dummy. **Optional URL fields** (`AGENT_HIRED_WEBHOOK`, Sentry DSN, etc.) must be omitted/commented out or set to a real URL — a bare `dummy` string fails `z.url()` and crashes Web after Ready.
- **`COMPOSIO_API_KEY`**: Core Zod allows omitting it, but if set it **must start with `ak_`**. A dummy like `dummy-composio-api-key` fails boot (`Invalid string: must start with "ak_"`). Use `ak_…` dummy or comment/remove the key
- `APP_SIGNING_SECRET` (web) equals `BETTER_AUTH_SECRET` (core)
- **`BETTER_AUTH_COOKIE_DOMAIN` must be unset / commented out for localhost.** Core `.env.example` sets `BETTER_AUTH_COOKIE_DOMAIN="sokosumi.com"` for production-shaped deploys — if that value is copied into local `.env`, session cookies are scoped to `.sokosumi.com` and **email/password login appears to succeed but the browser never keeps a session on `localhost`**. `doctor` fails when this trap is present
- Database reachable (Neon agent branch, or local Postgres). Prefer `with-db.mjs` when an agent branch is provisioned. Run `node scripts/cloud-agent-db/provision.mjs` when `NEON_API_KEY` + `NEON_PROJECT_ID` are set and `.cursor/cloud-agent-db.env` is missing
- `agent-browser` on `PATH` (global `npm i -g agent-browser` then `agent-browser install` for Chromium). Not a workspace dependency

### Cursor agent session (required pattern)

Short-lived agent shells often SIGHUP children when the launch command exits. Prefer the helper (`verify-sokosumi launch`) — it bootstraps `.env`, starts the portless proxy on **443**, and records named URLs in the pid file. If you must start by hand:

```bash
pnpm env:bootstrap
pnpm portless:proxy   # HTTPS :443; may sudo once. Do not fall back to :1355.
# background: node scripts/local-env/portless-dev.mjs run
# or: pnpm portless:dev
```

Read `web_url=` / `core_url=` from doctor (or `pnpm portless:url web`). If `.cursor/cloud-agent-db.env` exists, `portless:dev` already wraps with `with-db.mjs`.

### Durable human terminal

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi launch
```

Helper bootstraps `.env`, starts `portless proxy` on 443, then Core/Web via `pnpm portless:dev` (same coordinator). If `.cursor/cloud-agent-db.env` exists, both are wrapped with `with-db.mjs`.

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

Doctor also prints `fixture_auth=ok|fail` (Core `POST /auth/sign-in/email` for `alice@sokosumi.test`), `vault_profile=…` when `agent-browser auth list` has the coworker profile, and whether `agent-browser` is on `PATH`. Fixture failure is a **warn** (local/shared DB may lack seeds) — not a doctor fail. On cloud-agent Neon branches, expect `fixture_auth=ok` before driving. On a coworker machine or shared Neon, expect `fixture_auth=fail` and use the vault — do **not** seed Alice onto that database.

Optional Core-only smoke:

```bash
.cursor/skills/verify-sokosumi/bin/verify-sokosumi core-smoke
```

## Sign-in (use the harness)

Prefer the helper over hand-rolled browser clicks. `auto` (default):

1. Probe Core email sign-in for the fixture (`alice@sokosumi.test` unless overridden).
2. If the fixture works: UI Enter-submit, then Core cookie bootstrap.
3. If the fixture fails: coworker vault `agent-browser auth login sokosumi` with `[data-testid="auth-field-email"]` / `[data-testid="auth-field-currentPassword"]`. Persist check is `/agents` — do not wait `networkidle` on Welcome `/` or `/chat` (Ably can hang that wait).

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
.cursor/skills/verify-sokosumi/bin/verify-sokosumi doctor   # require doctor ok; fixture_auth=ok only on agent DBs
.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in  # fixtures, else vault
# or: … sign-in --admin
# or: … sign-in --method vault    # skip fixtures; coworker profile
# or: … sign-in --method cookie   # fixture cookie bootstrap only
# or: … sign-in --method ui       # fixture UI only (signin-submit proof)
# doctor / sign-in alias SESSION_NAME → AGENT_BROWSER_SESSION when unset
```

Artifacts land under `.cursor/verify-sokosumi-artifacts/sign-in/` (`after-login.snapshot.txt`, `after-login.png`, `account.txt`, `method.txt` = `ui` | `cookie` | `vault`). Cookie-only unlocks later features — for `signin-submit` proof, require `method=ui`. Vault unlocks the map on coworker/shared Neon; it is not fixture `signin-submit` proof.

## Drive

Harness: **agent-browser** (see `.agents/skills/agent-browser/SKILL.md` and `apps/web/AGENTS.md` Browser Automation). No Playwright/Cypress in this repo.

Cloud Agent **computer-use** (GUI browser subagent) is a fallback when `agent-browser` is unavailable — **same auth and env rules apply**. **Auth order:** (1) `verify-sokosumi doctor` → read `verify_credentials_*=set|unset`; (2) prefer `verify-sokosumi sign-in` so the harness reads `VERIFY_SOKOSUMI_*` from the process env; (3) only then drive UI with computer-use. **Never invent** random `/signup` users when secrets are missing or fixtures fail — stop and report. `VERIFY_SOKOSUMI_EMAIL` must be an Environment Variable (Runtime Secret redacts the email so the model cannot learn which account to use). A Runtime Secret password cannot be typed by computer-use; use the harness. Computer-use pitfalls (live-proved): Magic Link’s email field sits above the password form; JS `value=` does not satisfy react-hook-form (type keys); Chrome “Save password?” after login steals clicks — dismiss it. Full recipe in [sign-in.md](./features/sign-in.md).

Session reuse:

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi
# agent-browser 0.35+ isolates on AGENT_BROWSER_SESSION; the harness aliases
# SESSION_NAME → SESSION when SESSION is unset. Prefer both, or rely on
# `verify-sokosumi sign-in` / doctor to export the alias.
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-$AGENT_BROWSER_SESSION_NAME}"
```

Stable auth selectors: `[data-testid="auth-field-email"]`, `[data-testid="auth-field-currentPassword"]`, `[data-testid="auth-submit"]`.

**Login rule (manual drive):** fill email/password fields only, then **press Enter** — do not click submit, Google, Microsoft, Passkey, or Magic Link. react-hook-form can race a programmatic click; social/passkey controls sit **above** the password form and steal automation focus. After login, expect Welcome `/` (or `returnUrl`); open `/agents` to prove the session. Do not `wait --load networkidle` on Welcome `/` or `/chat`.

If UI login leaves you on `/signin` or bounces back after a “success” (classic `BETTER_AUTH_COOKIE_DOMAIN` trap, or passkey/OAuth interference), fix env first, then `verify-sokosumi sign-in --method cookie` when fixtures work, or `--method vault` on a coworker machine (see [sign-in.md](./features/sign-in.md)). API bootstrap alone is not UI proof — reopen a protected page in the browser after injecting cookies.

Credentials (pick **in this order** — do not skip to signup):

| Source | Email | Password | When |
| --- | --- | --- | --- |
| Env secrets | `$VERIFY_SOKOSUMI_EMAIL` | `$VERIFY_SOKOSUMI_PASSWORD` | Always first when `verify_credentials_*=set` (doctor / `credentials-status`) |
| Cloud-agent fixtures | `alice@sokosumi.test` | `Password123!` | VERIFY_* unset **and** `fixture_auth=ok` on Neon `cloud-agent-*` |
| Cloud-agent admin | `admin@sokosumi.test` | `Password123!` | Admin UI `/admin` only |
| Cloud-agent bob | `bob@sokosumi.test` | `Password123!` | Second-user scenarios only |
| Coworker vault | `agent-browser auth save sokosumi …` | machine-local | Shared/preprod Neon or local DB — never seed Alice here |
| Local signup | unique `*@sokosumi.test` via `/signup` | choose once | **Only** when testing signup itself — never as a computer-use fallback |

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

Env overrides: `VERIFY_SOKOSUMI_WEB_URL`, `VERIFY_SOKOSUMI_CORE_URL` (default: `pnpm portless:url web` / `core`), `VERIFY_SOKOSUMI_STATE_DIR`, `VERIFY_SOKOSUMI_ARTIFACT_ROOT`, `VERIFY_SOKOSUMI_EMAIL`, `VERIFY_SOKOSUMI_PASSWORD` (unset VERIFY_* copies `login_email` / `login_pwd` when those runtime secrets exist), `VERIFY_SOKOSUMI_VAULT_PROFILE`. `AGENT_BROWSER_SESSION_NAME` (preferred `sokosumi`) is aliased to `AGENT_BROWSER_SESSION` when the latter is unset.

`sign-in` / doctor UI paths auto-export `AGENT_BROWSER_ARGS=--ignore-certificate-errors` for HTTPS named URLs when unset (Chromium on Linux often rejects the portless CA). Override with your own `AGENT_BROWSER_ARGS` if needed — the helper appends the flag when missing.

## Isolate

Each git worktree gets its own named URLs (`https://web.sokosumi.localhost` on the main checkout, `https://<branch>.web.sokosumi.localhost` in a linked worktree). Concurrent stacks on one machine are supported. The helper refuses only if **this** worktree's named URLs already answer. Cloud agents still get an isolated Neon branch per conversation.

## Gotchas (always)

- Portless proxy must be HTTPS on **443**. If `pnpm portless:url web` prints `:1355` or `http://`, stop and run `pnpm portless:proxy` (sudo). Do not drive the fallback port.
- One-time on a machine: `pnpm exec portless trust` (CA) if `portless doctor` says the CA is untrusted. Then `pnpm portless:proxy`.
- Ambient `DATABASE_URL` can override `.env` — use `with-db.mjs` when `.cursor/cloud-agent-db.env` exists
- Drive `$WEB_URL` from doctor, not `localhost:3000`. Cookie inject uses `--secure` on https named hosts.
- **Portless TLS + agent-browser:** if navigation fails with `ERR_CERT_AUTHORITY_INVALID`, ensure `pnpm exec portless trust`, then rely on harness `AGENT_BROWSER_ARGS=--ignore-certificate-errors` (auto for `verify-sokosumi sign-in`) or export it yourself for manual drives.
- **`BETTER_AUTH_COOKIE_DOMAIN=sokosumi.com` (or any production domain) on localhost** → cookies never stick; disable it before blaming the form
- Copying `.env.example` without replacing `<…>` placeholders → Core/Web fail Zod at boot (“missing env”)
- Optional URL env vars (`AGENT_HIRED_WEBHOOK`, Sentry DSN) set to non-URL dummies → Web crashes after Ready (`z.url()`); omit or use a real URL
- `COMPOSIO_API_KEY` set without an `ak_` prefix → Core refuses to start (optional key; omit or use `ak_…`)
- `/agents` stacks the Coworker gallery above an Agent catalog (`Browse all agents` when catalog data is present). Empty coworker data blanks the gallery section; the catalog stays independent. App Hire stays off. Cookie **Accept all** covers lower catalog cards until dismissed.
- Authenticated default landing is Welcome `/` (`DEFAULT_AUTHENTICATED_LANDING_PATH`), not `/chat`. Desktop (`md+`) `/chat` redirects to `/`; mobile may keep `/chat`.
- Desktop main nav includes **Files** (`/drive`) after Tasks (and Schedules when that beta item is on). Mobile keeps Files on the You page, not the sidebar.
- Ably placeholders break realtime chat UI
- Fixtures exist only on agent Neon branches, not production/`main`. `fixture_auth=fail` on a coworker/shared Neon → vault or signup; never seed Alice onto that DB
- After login, prove the session on `/agents` (or `/setup` for brand-new users without a workspace). `wait --load networkidle` on Welcome `/` or `/chat` can hang (Ably)
- Node **24.x** required
- `/signin` shows Google / Microsoft / Passkey / Magic Link **above** the password form — automation must target `[data-testid="auth-field-*"]` only
- New signup users may land on `/setup` (workspace onboarding) before `/agents` works — still authenticated if not bounced to `/signin`
