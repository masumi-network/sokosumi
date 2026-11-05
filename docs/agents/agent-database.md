# Agent database via `DATABASE_URL`

Each Cursor Cloud agent run, and each local checkout or worktree with a Neon
key, can get an **ephemeral Neon branch** forked from production (`main` by
default), injected as `DATABASE_URL` / `DATABASE_URL_UNPOOLED`. The branch already has real schema and catalog data.
Provision still upserts **guarded auth fixtures** (known email/password logins)
on agent branches only. Pending Prisma migrations apply on provision when the
git branch is ahead of production schema.

## Secrets (required)

Set these on the **Cursor Cloud environment** (Runtime Secrets) and as
**GitHub Actions secrets** for teardown:

| Name              | Where                                         | Purpose       |
| ----------------- | --------------------------------------------- | ------------- |
| `NEON_API_KEY`    | Cursor secret + `NEON_API_KEY` Actions secret | Neon API auth |
| `NEON_PROJECT_ID` | Cursor secret / env + Actions secret          | Neon project  |

Optional:

| Name                 | Default        | Purpose                               |
| -------------------- | -------------- | ------------------------------------- |
| `NEON_PARENT_BRANCH` | `main`         | Production parent branch to fork from |
| `NEON_DATABASE_NAME` | `neondb`       | Database name on the branch           |
| `NEON_ROLE_NAME`     | `neondb_owner` | Role for connection URIs              |

**Do not** set a static production `DATABASE_URL` in Cursor secrets. Agents must
never write to the live production parent. Provision always forks a child
branch named `cloud-agent-<run-id>`.

## Worktree sessions (`pnpm db:up`)

Outside Cursor, run these from the checkout root. Every agent session in the
same checkout (Claude, Codex, Grok, a shell) shares one branch:

```bash
pnpm db:up           # create or reuse this checkout's branch, add this session's lease
pnpm db:status       # branch, expiry, sessions holding it
pnpm db:down         # drop this session's lease; delete the branch when none remain
pnpm db:down --force # delete the branch even while other sessions hold it
```

- **Neon key:** `NEON_API_KEY` / `NEON_PROJECT_ID` from the environment, else
  `~/.config/sokosumi/neon.env` (`KEY=value` lines, mode 600). Without a key,
  `db:up` skips and the checkout keeps the local Postgres in `apps/core/.env`.
- **Branch:** `cloud-agent-bc-<sha256 of the checkout path>`, so a resumed
  session finds the same branch and each worktree gets its own. Inside Cursor
  the run id stays `CURSOR_CONVERSATION_ID`.
- **Leases:** one file per session in `.agent-db/sessions/`. The session id
  is the first of: `--session <id>`, the hook JSON `session_id` (`--hook`),
  `AGENT_DB_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`, the hc terminal
  (`hc-$HC_SCOPE-$HC_TERMINAL_ID`), `CODEX_THREAD_ID`, the nearest ancestor
  process that is not a shell or pnpm/node wrapper (`pid-<n>`, the agent
  itself), and `shell`. Grok tool shells carry no session id
  (`GROK_SESSION_ID` is hook-only), so Grok gets the hc or process id.
  `db:down --force` deletes the branch but leaves other sessions' leases. A
  crashed session's lease stays; the branch then expires through the 72 h
  Neon TTL.
- **Lock:** `db:up` and `db:down` hold `.agent-db/lock` (pid and token
  inside; released only by its owner). A dead holder's lock is taken over
  under `.agent-db/lock.takeover`, which counts as stale after 30 s; a lock
  still empty after 10 s (writer crashed) counts as dead. `db:up` writes its lease before provisioning
  and `db:down` decides on teardown under the lock, so a session joining
  during a teardown waits, then provisions a fresh branch. Known limit: if a
  takeover crashes and two waiters then clear its old guard at the same
  moment, both can take over; move to a heartbeat lock if that is ever seen.
- **Env files:** `db:up` runs `pnpm env:bootstrap` when `apps/core/.env` is
  missing, then provision writes the URLs into `apps/core/.env`,
  `apps/web/.env` and `packages/database/.env` (Prisma's config loads `.env`
  from `packages/database`). No shell rc block is written outside Cursor:
  exported variables beat `.env`, so one would point every worktree at the
  last provisioned branch.
- **Claude Code hooks:** `node "$(git rev-parse --show-toplevel)/scripts/agent-db/db.mjs" status --hook`
  on `SessionStart` prints a database hint into the session;
  `… db.mjs down --hook` on `SessionEnd` releases the hook's `session_id`
  lease and does nothing when that session never ran `db:up`.

## Provision (how agents get the URL)

`.cursor/environment.json` runs provision after a Corepack-backed `pnpm install`
(`scripts/agent-db/ensure-pnpm.sh` avoids a broken pnpm 12 `.tools`
placeholder that fails environment builds with `Syntax error: ")" unexpected`):

```bash
bash scripts/agent-db/ensure-pnpm.sh install && node scripts/agent-db/provision.mjs
```

When `CURSOR_AGENT=1` (or `CLOUD_AGENT_DB_FORCE=1`, which `pnpm db:up` sets)
and Neon secrets are present, provision:

1. Resolves the agent run id (`CLOUD_AGENT_RUN_ID`, else `CURSOR_CONVERSATION_ID`, e.g. `bc-…`)
2. Reuses `cloud-agent-<run-id>` if it already exists (resume); otherwise creates
   it from `NEON_PARENT_BRANCH` (never from another agent branch)
3. Sets Neon `expires_at` to **now + 72 hours** (idle TTL)
4. Writes:
   - `.agent-db/db.env` (shell-sourceable)
   - `.agent-db/urls.json` (for `with-db.mjs`)
   - `.agent-db/state.json` (branch metadata)
   - patches `apps/core/.env` and `apps/web/.env` when present, and writes
     `packages/database/.env`
   - in Cursor only (`CURSOR_AGENT=1`), injects a source block into
     `~/.bashrc` / `~/.profile`

   Checkouts provisioned before `.agent-db/` keep `.cursor/cloud-agent-db.*`;
   `with-db.mjs`, teardown and `db:status` read those as a fallback, and the
   next provision moves them to `.agent-db/`.
5. Runs `pnpm prisma:migrate:deploy` with `DATABASE_URL_UNPOOLED`
6. Upserts **guarded auth fixtures** (known email/password logins) — agent
   branches only; never against production/`main`

If connection setup fails after create, provision **deletes the orphan branch**.

## Auth fixtures (login)

Production-forked data has real users but unknown passwords. After migrate,
provision upserts disposable Better Auth credential accounts:

| Email                 | Password       | Notes                                                                                                                                 |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `admin@sokosumi.test` | `Password123!` | Platform admin (`role: admin`) + personal workspace + owner of `admin-fixture` org                                                    |
| `alice@sokosumi.test` | `Password123!` | Regular user + personal workspace + owner of `alice-fixture` org                                                                      |
| `bob@sokosumi.test`   | `Password123!` | Regular user + personal workspace + owner of `bob-fixture` org                                                                        |
| `zero@sokosumi.test`  | `Password123!` | Regular user with credential account only — **no** personal workspace, **no** organization / membership (identity-onboarding fixture) |

Fixtures opt into personal workspace + org by default. Set `createPersonalWorkspace: false` and omit / null `organization` in `scripts/agent-db/fixtures.mjs` to seed a zero-workspace user. Org fixtures still get an **organization workspace** (`organization.slug` above) with the user as `member.role = owner`. Re-seed is idempotent on slug.

**Guards:** fixtures run only when provision state has a `cloud-agent-*` branch
name (and a `DATABASE_URL`). They refuse `main` / other non-agent branches.
Skip with `CLOUD_AGENT_DB_SKIP_FIXTURES=1`. Manual re-run:

```bash
node scripts/agent-db/with-db.mjs -- pnpm agent-db:seed-auth
```

Manual / forced local dry-run:

```bash
CLOUD_AGENT_DB_FORCE=1 \
CLOUD_AGENT_RUN_ID=bc-00000000-0000-0000-0000-000000000001 \
NEON_API_KEY=… NEON_PROJECT_ID=… \
node scripts/agent-db/provision.mjs
```

## Using the database in agent commands

Prefer the override wrapper so ambient/stale `DATABASE_URL` cannot win:

```bash
node scripts/agent-db/with-db.mjs -- pnpm core:dev
node scripts/agent-db/with-db.mjs -- pnpm prisma:migrate:deploy
```

`environment.json` `start` already uses `with-db.mjs` for `pnpm dev`.

In Cursor, login shells also pick up `.agent-db/db.env` via bashrc/profile.

## Teardown

Teardown **only** deletes branches named `cloud-agent-*`. It never deletes the
production / `main` parent (or any non-agent branch).

| Trigger                       | Mechanism                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR merged                     | GitHub Action `agent-db-teardown.yml` on `workflow_run` of `PR closed`; extracts `bc-…` ids from same-repo PR bodies via the API. Privileged YAML always comes from the default branch. |
| PR closed without merge       | Same workflow                                                                                                                                                                           |
| Worktree session ends         | `pnpm db:down` (deletes the branch when it held the last lease)                                                                                                                         |
| Agent finishes with **no PR** | Agent runs `node scripts/agent-db/teardown.mjs` (uses local state / `CURSOR_CONVERSATION_ID`)                                                                                           |
| Agent archived                | Same explicit teardown when possible; otherwise Neon idle TTL                                                                                                                           |
| Idle **72h**                  | Neon `expires_at` on create/resume only (no scheduled Action backup)                                                                                                                    |

Manual:

```bash
node scripts/agent-db/teardown.mjs
node scripts/agent-db/teardown.mjs --agent-id bc-…
node scripts/agent-db/teardown.mjs --from-text "$(gh pr view 123 --json body -q .body)"
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
Provision skips cleanly and prints a warning. See [`docs/agents/cloud-environment.md`](./cloud-environment.md).

## Tests

```bash
pnpm agent-db:test
```
