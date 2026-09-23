# Local development and browser verification

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

## Environment & Tooling

### Dependencies

- **Pin exact versions** for all external npm packages in workspace `package.json` files (no `^`, `~`, `>=`, or `*` ranges). Use `workspace:*` only for monorepo-internal packages. See [Pinned dependencies](../../.cursor/rules/pinned-dependencies.mdc).

### Prerequisites

- Node.js 24.x
- pnpm package manager

### Setup

1. Run `pnpm install` at repo root
2. `pnpm env:bootstrap` — copies `.env.example` → `.env` (web + core) and sanitizes placeholders / the `BETTER_AUTH_COOKIE_DOMAIN` trap. Grok/git worktrees reuse the primary checkout `.env` (`BETTER_AUTH_SECRET`, `DATABASE_URL`) unless the worktree already has a unique secret. Do not leave `<…>` values; optional URL keys must be omitted, not set to `dummy`
3. One-time per machine: `pnpm exec portless trust` if `portless doctor` reports an untrusted CA, then `pnpm portless:proxy` (HTTPS **443**, may sudo). Fail if the URL is `:1355` / `http://` — do not drive the fallback
4. Bootstrap database: `pnpm prisma:migrate:dev`
5. Generate Prisma clients: `pnpm prisma:generate`

## Commands

Full list is in root `package.json`. Agents typically need:

| Command | Purpose |
| ---------------------- | ----------------------------- |
| `pnpm portless:dev` | Web + Core via portless (worktree-safe named URLs) |
| `pnpm portless:web` / `core` | One app via portless (still injects both named URLs) |
| `pnpm portless:proxy` | Start portless HTTPS proxy on 443 |
| `pnpm portless:url web` / `core` | Print this checkout's named HTTPS URL |
| `pnpm check` | Repo-wide Biome (`biome check .`) |
| `pnpm typecheck` | Turbo typecheck |
| `pnpm test` | Turbo tests |
| `pnpm prisma:generate` | Generate Prisma clients |
| `pnpm prisma:migrate:dev` | Dev migrations |
| `pnpm prisma:migrate:deploy` | Apply migrations |

Prefer the turbo entry points above over `pnpm --filter <workspace> <task>`. A filter-run invokes the package script directly and skips turbo's graph, so `prisma:generate` never fires. On a checkout where the client has not been generated that surfaces as a wall of `Module '"@sokosumi/database"' has no exported member 'Job'` — a missing client, not a broken change. Run `pnpm prisma:generate` first when you do need a filter-run.

### Running & known local gotchas

- Start services: **`pnpm portless:dev`** (or `.cursor/skills/verify-sokosumi/bin/verify-sokosumi launch`). URLs: `pnpm portless:url web` and `pnpm portless:url core` (git worktrees prefix the branch; Grok copies under `.grok/worktrees/` prefix the directory basename, e.g. `3877.web.sokosumi.localhost`). Do not use bare `portless get web.sokosumi` in Grok copies. Launch uses `--force` and stops the other app if Core/Web exits. Core OpenAPI at `$CORE_URL/v1/openapi.json`. Classic `pnpm core:dev` / `pnpm web:dev` still bind `:8787` / `:3000` when nothing else owns those ports. Cloud VM `start` may still wrap `pnpm dev`; local worktree agents must use portless so stacks do not collide.
- **Computer-use login (mandatory order — do not invent users):**
  1. Run `verify-sokosumi doctor` and read `verify_credentials_email=` / `verify_credentials_password=` (`set` | `unset`). Those come from environment secrets `VERIFY_SOKOSUMI_EMAIL` / `VERIFY_SOKOSUMI_PASSWORD` (aliases `login_email` / `login_pwd`).
  2. **Prefer** `.cursor/skills/verify-sokosumi/bin/verify-sokosumi sign-in` (agent-browser) for auth. The harness reads the password from the process env without the model needing to type a Runtime Secret. Only after a session exists should computer-use drive UI.
  3. If computer-use must type the form: email into `[data-testid="auth-field-email"]`, password into `[data-testid="auth-field-currentPassword"]`, then Enter. Never print the password. **`VERIFY_SOKOSUMI_EMAIL` must be an Environment Variable** (not Runtime Secret) so the model can read which account to use — Runtime Secrets redact as `[REDACTED]` in tool output. A Runtime Secret password cannot be typed by computer-use; use the harness instead.
  4. **Never invent** random `/signup` users (`you-*@sokosumi.test`, timestamp emails, etc.) for general UI proof. If `verify_credentials_*=unset` and Alice fixtures fail (`fixture_auth=fail`), **stop and report missing secrets** — do not improvise an account. Signup is only for testing signup itself (see [`.cursor/skills/verify-sokosumi/features/sign-up.md`](../../.cursor/skills/verify-sokosumi/features/sign-up.md)).
  5. Alice / admin / bob fixtures apply only when VERIFY_* is empty **and** `fixture_auth=ok` on a cloud-agent Neon branch.
- **Auth for a test account:** on a provisioned agent Neon branch, use fixtures `admin@sokosumi.test` (platform admin), `alice@sokosumi.test`, or `bob@sokosumi.test` with password `Password123!` (upserted after migrate; agent branches only). Those three each own one org (`admin-fixture` / `alice-fixture` / `bob-fixture`) with an organization workspace. Identity-onboarding fixture: `zero@sokosumi.test` / `Password123!` — no personal workspace, no org. Otherwise email/password signup works with no email verification and auto sign-in (`/signup`). Google/Microsoft OAuth and magic-link email do **not** work (placeholder credentials).
- **Agents catalog:** on a Neon agent branch forked from production, catalog/billing data comes from the parent. On empty local Postgres, `GET /v1/agents` / `/v1/categories` may 500 until `credit_cost` has rows (admin `POST /v1/credit-costs` / `/admin` UI) — missing data, not a broken build.
- **Realtime (Ably) is unconfigured:** `POST /api/ably/auth` proxies Core `POST /v1/realtime/ably-token`; chat pages surface a "Something went wrong" modal when Core `ABLY_SUBSCRIBE_ONLY_KEY` / `ABLY_PUBLISH_ONLY_KEY` are placeholders. Optional; unrelated to setup.
- Lint (`pnpm lint`), tests (`pnpm test`), and type checks do **not** need the DB or the servers running.
