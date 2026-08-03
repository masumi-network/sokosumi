# Cloud agent database via `DATABASE_URL`

Each Cursor Cloud agent run can get an **ephemeral Neon branch** forked from
production (`main` by default), injected as `DATABASE_URL` /
`DATABASE_URL_UNPOOLED`. The branch already has real schema and data — **no
seed step**. Pending Prisma migrations apply on provision when the git branch
is ahead of production schema.

## Secrets (required)

Set these on the **Cursor Cloud environment** (Runtime Secrets) and as
**GitHub Actions secrets** for teardown:

| Name | Where | Purpose |
| --- | --- | --- |
| `NEON_API_KEY` | Cursor secret + `NEON_API_KEY` Actions secret | Neon API auth |
| `NEON_PROJECT_ID` | Cursor secret / env + Actions secret | Neon project |

Optional:

| Name | Default | Purpose |
| --- | --- | --- |
| `NEON_PARENT_BRANCH` | `main` | Production parent branch to fork from |
| `NEON_DATABASE_NAME` | `neondb` | Database name on the branch |
| `NEON_ROLE_NAME` | `neondb_owner` | Role for connection URIs |

**Do not** set a static production `DATABASE_URL` in Cursor secrets. Agents must
never write to the live production parent. Provision always forks a child
branch named `cloud-agent-<run-id>`.

## Provision (how agents get the URL)

`.cursor/environment.json` runs provision after `pnpm install`:

```bash
pnpm install && node scripts/cloud-agent-db/provision.mjs
```

When `CURSOR_AGENT=1` and Neon secrets are present, provision:

1. Resolves the agent run id (`CURSOR_CONVERSATION_ID`, e.g. `bc-…`)
2. Reuses `cloud-agent-<run-id>` if it already exists (resume); otherwise creates
   it from `NEON_PARENT_BRANCH` (never from another agent branch)
3. Sets Neon `expires_at` to **now + 72 hours** (idle TTL)
4. Writes:
   - `.cursor/cloud-agent-db.env` (shell-sourceable)
   - `.cursor/cloud-agent-db.urls.json` (for `with-db.mjs`)
   - `.cursor/cloud-agent-db.state.json` (branch metadata)
   - patches `apps/core/.env` and `apps/web/.env` when present
   - injects a source block into `~/.bashrc` / `~/.profile`
5. Runs `pnpm prisma:migrate:deploy` with `DATABASE_URL_UNPOOLED`
6. Upserts **guarded auth fixtures** (known email/password logins) — agent
   branches only; never against production/`main`

If connection setup fails after create, provision **deletes the orphan branch**.

## Auth fixtures (login)

Production-forked data has real users but unknown passwords. After migrate,
provision upserts disposable Better Auth credential accounts:

| Email | Password | Notes |
| --- | --- | --- |
| `admin@sokosumi.test` | `Password123!` | Platform admin (`role: admin`) + personal workspace + owner of `admin-fixture` org |
| `alice@sokosumi.test` | `Password123!` | Regular user + personal workspace + owner of `alice-fixture` org |
| `bob@sokosumi.test` | `Password123!` | Regular user + personal workspace + owner of `bob-fixture` org |

Each fixture also gets an **organization workspace** (`organization.slug` above) with the user as `member.role = owner`. Re-seed is idempotent on slug.

**Guards:** fixtures run only when provision state has a `cloud-agent-*` branch
name (and a `DATABASE_URL`). They refuse `main` / other non-agent branches.
Skip with `CLOUD_AGENT_DB_SKIP_FIXTURES=1`. Manual re-run:

```bash
node scripts/cloud-agent-db/with-db.mjs -- pnpm cloud-agent-db:seed-auth
```

Manual / forced local dry-run:

```bash
CLOUD_AGENT_DB_FORCE=1 \
CLOUD_AGENT_RUN_ID=bc-00000000-0000-0000-0000-000000000001 \
NEON_API_KEY=… NEON_PROJECT_ID=… \
node scripts/cloud-agent-db/provision.mjs
```

## Using the database in agent commands

Prefer the override wrapper so ambient/stale `DATABASE_URL` cannot win:

```bash
node scripts/cloud-agent-db/with-db.mjs -- pnpm core:dev
node scripts/cloud-agent-db/with-db.mjs -- pnpm prisma:migrate:deploy
```

`environment.json` `start` already uses `with-db.mjs` for `pnpm dev`.

Login shells also pick up `.cursor/cloud-agent-db.env` via bashrc/profile.

## Teardown

Teardown **only** deletes branches named `cloud-agent-*`. It never deletes the
production / `main` parent (or any non-agent branch).

| Trigger | Mechanism |
| --- | --- |
| PR merged | GitHub Action `cloud-agent-db-teardown.yml` on `pull_request` closed; extracts `bc-…` ids from PR body (Cursor agent links) |
| PR closed without merge | Same workflow |
| Agent finishes with **no PR** | Agent runs `node scripts/cloud-agent-db/teardown.mjs` (uses local state / `CURSOR_CONVERSATION_ID`) |
| Agent archived | Same explicit teardown when possible; otherwise Neon idle TTL |
| Idle **72h** | Neon `expires_at` on create/resume only (no scheduled Action backup) |

Manual:

```bash
node scripts/cloud-agent-db/teardown.mjs
node scripts/cloud-agent-db/teardown.mjs --agent-id bc-…
node scripts/cloud-agent-db/teardown.mjs --from-text "$(gh pr view 123 --json body -q .body)"
```

### PR body convention

Agent-opened PRs should keep the Cursor agent URL in the body (default
ManagePullRequest footer includes `https://cursor.com/agents/bc-…`). Teardown
parses those ids. If you strip the footer, add:

```text
Cloud-Agent-Run: bc-<run-id>
```

## Safety

- Parent is always `NEON_PARENT_BRANCH` (production baseline), never another
  agent or arbitrary preview branch
- Child branches are disposable and TTL-bound
- Failed provision cleans up orphans
- Teardown refuses `default` / `protected` branches and any name not prefixed
  `cloud-agent-`

## Local Postgres (unchanged)

Laptop / snapshot local Postgres remains available when Neon secrets are absent.
Provision skips cleanly and prints a warning. See root `AGENTS.md`.

## Tests

```bash
node --test scripts/cloud-agent-db/__tests__/cloud-agent-db.test.mjs
```
