# Cursor Cloud environment

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

## Cursor Cloud specific instructions

These notes cover non-obvious, durable facts about running this repo in the Cursor Cloud VM. The update script runs Corepack-backed `pnpm install` (`scripts/cloud-agent-db/ensure-pnpm.sh`) then provisions an ephemeral Neon agent database when secrets are present (see below). Node, tooling, and non-DB `.env` values may still come from the VM snapshot.

### Runtime versions

- **Node 24 is the required runtime** (root `.nvmrc` = `lts/krypton`; apps and packages pin `"engines": { "node": "24.x" }` — root `package.json` has no `engines` field). The base image's `/exec-daemon/node` is Node 22 and is early in `PATH`, so Node 24 (installed via nvm) is symlinked into `/usr/local/cargo/bin` (which is first in `PATH`) as `node`/`npm`/`npx`/`corepack`/`pnpm`. This makes `node -v` report Node 24 in **every** shell (login or not). If a future run somehow sees Node 22, recreate those symlinks from `~/.nvm/versions/node/v24*/bin`.
- **pnpm via Corepack:** Environment `install`/`start` call `scripts/cloud-agent-db/ensure-pnpm.sh`, which `corepack prepare`s the pin in root `package.json` `packageManager` and deletes `~/.local/share/pnpm/.tools/pnpm`. A leftover pnpm 12 standalone placeholder there is not a valid shell script and fails builds with `Syntax error: ")" unexpected`. Read `packageManager` for the version — do not remember a `pnpm -v` number here. Do **not** re-add a `devEngines.packageManager` block: npm reads it on every `npm`/`npx` invocation in the tree and emits `EBADDEVENGINES` warnings (with `onFail: "error"` it refuses to run at all, breaking `npx` at the repo root and from `apps/apple`). `packageManager` alone is what Corepack — locally and on Vercel — actually uses.

### Database (Cloud agent Neon branch)

Cloud agents get a **disposable Neon branch** forked from production/`main`, not a shared mutable DB and not live production writes.

- **Provision:** `.cursor/environment.json` `install` runs `bash scripts/cloud-agent-db/ensure-pnpm.sh install` then `node scripts/cloud-agent-db/provision.mjs` when `CURSOR_AGENT=1` and `NEON_API_KEY` + `NEON_PROJECT_ID` are set (Cursor Runtime Secrets). Branch name: `cloud-agent-<CURSOR_CONVERSATION_ID>`. Parent is always `NEON_PARENT_BRANCH` (default `main`). Resume reuses the same branch and refreshes the **72h** `expires_at` TTL. Pending migrations run via `pnpm prisma:migrate:deploy` (`DATABASE_URL_UNPOOLED`). After migrate, upserts guarded auth fixtures (`admin@sokosumi.test` / `alice@sokosumi.test` / `bob@sokosumi.test` / `zero@sokosumi.test` / `Password123!`) on agent branches only — **not** a full catalog seed.
- **Use:** Prefer `node scripts/cloud-agent-db/with-db.mjs -- <command>` so ambient/stale `DATABASE_URL` cannot win. `start` already wraps `ensure-pnpm.sh dev`. Login shells source `.cursor/cloud-agent-db.env` via bashrc/profile.
- **Teardown:** deletes only `cloud-agent-*` branches — never production/`main`. Triggers: PR merged/closed (GitHub Action parses `bc-…` from PR body), agent completes with no PR (`pnpm cloud-agent-db:teardown`), agent archived (same when possible). Idle **72h** expiry is Neon `expires_at` only (no scheduled Action GC).
- **Do not** put a static production `DATABASE_URL` in Cursor secrets. Full runbook: [`docs/agents/cloud-agent-database.md`](../../docs/agents/cloud-agent-database.md).

### Database (local PostgreSQL fallback)

When Neon secrets are absent, provision skips and local Postgres remains the fallback (snapshot-oriented).

- Local cluster is **PostgreSQL 16** (apt). It is **not started on boot** — start it with `sudo pg_ctlcluster 16 main start` (check with `pg_lsclusters`). DB `core`, role `sokosumi` / password `sokosumi`, on `localhost:5432`.
- **Gotcha — ambient `DATABASE_URL`:** if the platform still injects a stale Neon URL (`...neon.tech...`, auth fails), `dotenv` does **not** override it. Prefer `with-db.mjs` when a provisioned agent branch exists; otherwise use a login shell (provision injects bashrc) or prefix commands with the local URL. If you see `Authentication failed against the database server` or an unexpected `neon.tech` host without a provisioned agent branch, unset/override `DATABASE_URL`.
- Schema is already applied on the snapshot DB. After pulling schema changes without a Neon agent branch, run `pnpm prisma:generate` then `pnpm prisma:migrate:deploy`. To inspect local: `PGPASSWORD=sokosumi psql -h localhost -U sokosumi -d core`.

### `.env` files (gitignored, snapshot-persisted)

`apps/core/.env` and `apps/web/.env` were created from `.env.example` with local fixes so the apps boot past their Zod env validation. Non-obvious edits: DB host `sokosumi`→`localhost` (overwritten by agent DB provision when Neon secrets are present); `RESEND_FROM_EMAIL` defaults to `noreply@sokosumi.com`; invalid `AGENT_HIRED_WEBHOOK` placeholder removed; `BETTER_AUTH_COOKIE_DOMAIN` disabled so session cookies work on `localhost`. Web `APP_SIGNING_SECRET` is independent of Core `BETTER_AUTH_SECRET`.
