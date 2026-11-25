# Sokosumi Core API Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the Sokosumi Core API service. For comprehensive monorepo guidelines, see [`../../AGENTS.md`](../../AGENTS.md).

## App-Specific Architecture

**Framework**: Hono with Node.js runtime
**Location**: `apps/core/` directory within the pnpm workspace
**Key Directories**:

- `src/routes/v1/` - API route handlers organized by version
- `src/middleware/` - Request middleware (auth, logging, etc.)
- `src/helpers/` - Response and error helpers
- `src/lib/` - Shared utilities and configurations
- `src/schemas/` - Zod schemas for API validation

## Handler actor menu (user-scoped auth)

Middleware authenticates the actor and may **attach** coworker
`X-Context-*` headers (`coworkerContextMiddleware`). Handlers must **not**
re-check actors with ad-hoc `if (actor === "coworker")` branches. Pick one
helper at the top of the handler:

| Helper                         | Import                                    | Use when                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireUserContext`           | `@/middleware/auth`                       | Task/job grant-gated flows only. Coworker context may be **unbound** (no vendor grant yet) so delegated create can park as `GRANT_PENDING`.                                                                                                                                                                                                                                           |
| `requireAuthorizedUserContext` | `@/helpers/coworker-user-context-binding` | **Default** for user-scoped routes (profile, credits, projects, org metadata, …). Coworker must pass binding: DENIED/REVOKED → reject; GRANTED → allow; else baseline assignee/sibling task; else reject. A route that binds through it, directly or through a helper, wraps its route in `withCoworkerContextHeaderParameters` (`src/lib/hono-openapi-headers.test.ts` enforces it). |
| `requireOwnerUserContext`      | `@/middleware/auth`                       | Human/owner-only surfaces (notifications, history, billing, member lists, …). Interactive user session only; no coworker.                                                                                                                                                                                                                                                             |
| `requireUserAuthContext`       | `@/middleware/auth`                       | Must be the real interactive session user (admin role, consent). Rejects coworker.                                                                                                                                                                                                                                                                                                    |
| `resolveUserContext`           | `@/middleware/auth`                       | Task-collaboration routes that accept standalone coworker keys but still apply user-scoped gates (organization seat, Calendar beta). Returns the effective user, or `null` for a standalone coworker key.                                                                                                                                                                             |

**Data from other workspaces.** The binding authorizes the context workspace
only. An agent-callable route that returns data from the user's other
workspaces (organization lists, per-organization reads) passes those
organizations through `filterAuthorizedOrganizationIds`, so a vendor sees only
workspaces that granted it or hold its baseline task. Review checks this for
every route on the agent allowlist.

Policy details and decision order: `src/helpers/coworker-user-context-binding.ts`
and the `UserContext` JSDoc in `src/middleware/auth.ts`. Vendor grant semantics
for tasks: [`docs/coworker/vendor-workspace-grants-api.md`](../../docs/coworker/vendor-workspace-grants-api.md).

## Layout

The live tree is `apps/core/src/`.

| Area                                                 | Role                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `routes/v1/`                                         | Versioned HTTP handlers (one file per method)                                               |
| `routes/auth/`, `routes/sync/`, `routes/well-known/` | Auth, cron/sync, discovery                                                                  |
| `routes/health/`                                     | Unauthenticated liveness probe (`GET /health`), no database call                            |
| `routes/mcp/`, `lib/sokosumi-mcp/`                   | MCP server at `/mcp`: token check, tool registry, tool calls run through `/v1` in process   |
| `routes/image-studio-agent/`                         | Grant-authenticated surface the image-studio agent calls; no browser session                |
| `routes/webhooks/fal/`                               | fal completion callback for image jobs; ED25519 signature, not a session                    |
| `schemas/`                                           | Zod / OpenAPI                                                                               |
| `helpers/`                                           | Domain logic used by routes                                                                 |
| `lib/`                                               | Auth, Prisma (`lib/db/prisma.ts`), Hono, blob, Sentry, evlog                                |
| `lib/soko-bot/`                                      | Soko Bot control plane (sandbox + in-process adapters; contracts from `@sokosumi/soko-bot`) |
| `soko-bot-runner/`                                   | Agent loop bundled into each bot's Vercel Sandbox (calls Core `/v1/soko-bot-runtime`)       |
| `clients/`                                           | External HTTP clients                                                                       |
| `services/`                                          | Longer-lived / legacy service modules                                                       |
| `middleware/`                                        | Auth, org, workspace, coworker context                                                      |

**OAuth provider / first-party sign-up** (CMO, `prompt=create`, signed authorize query, user-create hooks): ADRs 0045, 0046, 0052 and the header of `lib/auth-sign-up-conversion.ts`. Hook and preview gotchas: [`docs/agents/auth.md`](../../docs/agents/auth.md).

**CMO Projects are read-only** ([ADR 0066](../../docs/adr/0066-cmo-projects-are-read-only-in-sokosumi.md)): a new Project-scoped write route outside `/v1/cmo/**` applies the lock (a path the matcher in `routes/v1/projects/cmo-project-lock.ts` covers, or a direct `requireNotCmoProject` call listed in `DIRECT_LOCKED` in `routes/v1/cmo-lock-responses.openapi.test.ts`) and declares the 409 `cmo_project_read_only` in its OpenAPI. That test checks only the routes it knows, so a route missing from both passes green while CMO Projects stay writable through it.

Email rendering lives in `@sokosumi/email`, not under Core `lib/email` or `locales/`.

## Core-Specific Conventions

### Concurrency Tradeoffs

For low-frequency, user-triggered mutations that are easy to retry, last-write-wins behavior is acceptable. Prefer the simpler direct update path over extra conditional write guards when all of these are true:

- the operation is initiated manually by a user
- concurrent collisions are unlikely in practice
- retrying the action is cheap and safe

Examples include workspace move operations for tasks and jobs. Do not add `updateMany`-style stale-write guards there unless the product requirement explicitly needs conflict detection.

#### Serializable Transactions

When a flow does need `Serializable` isolation (e.g. credit consumption, idempotency checks), use `serializableTransaction()` from `@/lib/db/transaction` instead of calling `prisma.$transaction` with `isolationLevel` directly. Postgres aborts serializable transactions with a serialization failure (Prisma `P2034`) under concurrent writes; the helper maps that to a retryable 409 conflict (`kind: "concurrency_conflict"`) instead of an unhandled 500. Routes using it must declare `409: jsonErrorResponse("Conflict")` in their OpenAPI responses.

The helper makes up to 8 attempts with exponential backoff (60 ms base, 1 s cap, plus jitter), so a route test that mocks a `P2034` rejection to assert the 409 waits seconds on real timers. Call `vi.useFakeTimers()`, start the request, `await vi.runAllTimersAsync()`, then await the response (`src/routes/v1/vendors/vendor-admin.test.ts`).

A read of the whole table before an `INSERT` inside `serializableTransaction()` makes a concurrent duplicate fail as a serialization failure (40001, retried as `P2034`), not as a unique violation (23505). This holds only while the read is a sequential scan: an index read takes finer predicate locks, and 23505 can then occur. Check the plan with `EXPLAIN` before you drop a `P2002` path.

#### Interactive Transactions (avoid on read-only GETs)

**Default: do not wrap read-only GET handlers in interactive `prisma.$transaction(async (tx) => …)`.** Pass the default `prisma` client into helpers that accept a `tx` / client argument (access gate, then list/count/unread). Helpers already accept either shape.

Interactive transactions hold a pool connection for the whole callback. Web pages that fire several Core GETs in parallel (e.g. chat room: room + messages + org members + coworkers) multiply that hold time → Prisma **P2028** (`Unable to start a transaction in the given time` / `maxWait`). Prior incidents: SOKOSUMI-Q9 (room GET), SOKOSUMI-Q7 (org members GET), SOKOSUMI-CORE-2J (workspace middleware).

Keep interactive transactions when the path needs a shared snapshot across writes, multi-step mutations, or true read-your-writes isolation. Access check + display read on a GET almost never do.

**Never `Promise.all` Prisma queries inside an interactive transaction** — Prisma does not support concurrent queries on the same interactive tx client (see #2559). Use sequential awaits inside the tx, or drop the interactive tx and parallelize on the default client / use batch `$transaction([...])`.

```typescript
// ❌ Read-only GET — holds a pool connection for the whole callback
const { room, unreadCounts } = await prisma.$transaction(async (tx) => {
  const room = await requireChatRoomUserAccess(id, userId, tx);
  const unreadCounts = await getChatRoomUnreadCounts([room.id], userId, tx);
  return { room, unreadCounts };
});

// ✅ Same reads on the default client — no interactive tx, no shared snapshot needed
const room = await requireChatRoomUserAccess(id, userId, prisma);
const unreadCounts = await getChatRoomUnreadCounts([room.id], userId, prisma);
```

### Authentication Classes

Use type-safe Hono class that automatically applies authentication:

```typescript
import { OpenAPIHonoWithAuth } from "@/lib/hono";

const app = new OpenAPIHonoWithAuth();
```

This class applies `authMiddleware` (`src/middleware/auth.ts`) itself. Do not add it again.

### Response Handling

Never call `c.json()` directly. Use the standardized response helpers: they keep every response in the same envelope.

#### Success Responses

```typescript
import { ok, created, empty } from "@/helpers/response";

// Return data
return ok(c, { user });

// Return newly created resource
return created(c, { resource });

// No content to return
return empty(c);
```

#### Error Responses

Never build error bodies with `c.json({ error: "..." }, statusCode)`. The global error handler writes the envelope:

```typescript
import {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessableEntity,
} from "@/helpers/error";

// ❌ Wrong
return c.json({ error: "Forbidden" }, 403);

// ✅ Correct
throw forbidden("You can only access your own user data");
```

Error helpers return an `HTTPException`. `throw` the result. A bare call does nothing.

A request whose body, query, or params fail the route's Zod schema returns **422** via `unprocessableEntity` (`defaultValidationHook` in `src/lib/hono.ts`), not 400. Tests for invalid input expect 422.

### Environment Variables

Environment variables are accessed via `process.env`, validated at startup with Zod in `src/config/env.ts`. See `apps/core/README.md` (Environment Configuration) for tables and `.env.example` for a full template.

**Common URL-related variables:**

- `PORT` — HTTP port (default `8787`; portless injects an ephemeral `4000–4999` port)
- `WEB_APP_BASE_URL` — Browser origin. Default `http://localhost:3000`; `pnpm portless:dev` / `pnpm portless:core` set this to `pnpm portless:url web`
- `BETTER_AUTH_SECRET` — Better Auth server secret (sessions, cookies, OAuth state) and the key for stored OAuth provider tokens. Do not replace it in place, or stored tokens become unreadable; rotate by setting `BETTER_AUTH_SECRETS` (`2:<new>,1:<old>`) and keeping this value. Independent of web `APP_SIGNING_SECRET`.
- `OAUTH_PROXY_SECRET` — Vercel only, shared by Production and Preview. Key for the `oAuthProxy` hand-off that lets previews sign in with Google and Microsoft through production Core. Keep it separate from `BETTER_AUTH_SECRET`, which the two environments do not share.
- `BETTER_AUTH_URL` — Public base URL of this Core service; used as Better Auth `baseURL` except on Vercel Preview
- `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` — Optional; on Preview, `getBetterAuthPublicBaseUrl()` prefers `VERCEL_BRANCH_URL` over `VERCEL_URL`, and prefers a `*.sokosumi.com` candidate when only one of those is on the preview suffix (see `@sokosumi/utils` `resolveBetterAuthPublicBaseUrl`)

**New Core Vercel project checklist (preview auth):** set team [Preview Deployment Suffix](https://vercel.com/docs/deployments/preview-deployment-suffix) to `preview.sokosumi.com` so `VERCEL_BRANCH_URL` / `VERCEL_URL` are sokosumi hosts. Without that, session cookies with `BETTER_AUTH_COOKIE_DOMAIN=sokosumi.com` fail on `*.vercel.app`.

**Note**: Environment variables are loaded via `dotenv/config` at the application entry point.

**Signup bonus** (Core only — granted on `user.create.after`, not via Stripe):

- `SIGNUP_BONUS_CREDITS` — credits per new user (default `3000`)
- `SIGNUP_BONUS_TTL_DAYS` — bucket expiry in days from grant time (default `30`)

Buckets use `referenceType: SIGNUP_BONUS` and `referenceId: user:{userId}`. Grants are idempotent per user via the `(referenceId, referenceType)` unique key.

**Operations:**

- Alert on Sentry events tagged `context:signup_bonus_grant`. Grant failures are swallowed so signup is not blocked; there is no batch backfill job.

**Free credits** (Core admin — granted via `POST /v1/admin/credits`, not via Stripe):

- Admin-only direct grants to a user or organization from the web UI at `/admin/free-credits`.
- Buckets use `referenceType: FREE`, `referenceId: user:{userId}:free:{grantId}` or `org:{orgId}:free:{grantId}`, and optional `referenceNote` (free-text audit note from the admin form).
- Each grant uses a new `grantId` (UUID); repeat grants to the same target are allowed.
- Organization grants attach credits to the org bucket and write `Transaction.userId` null. Personal grants still stamp the target user.

**Operations:**

- Schema for free credits (`FREE` reference type, `credit_bucket.referenceNote`) is applied automatically by Core’s Vercel build (`pnpm vercel-build` → `prisma migrate deploy` after a successful app build). Ensure pending migrations are committed before deploying Core.

### CORS and Better Auth origins

- **CORS** (`src/config/cors-allow-origin.ts`): `Access-Control-Allow-Origin` is echoed only for `https://sokosumi.com` / `https://*.sokosumi.com` in non-development, or for `localhost` with `http`/`https` when `NODE_ENV=development`. Wildcard Vercel preview hosts are not allowlisted.
- **Better Auth** (`src/lib/auth.ts`): `trustedOrigins` lists explicit web app hosts (`https://app.sokosumi.com`, `https://preprod.sokosumi.com`), plus `https://*.preview.sokosumi.com` on Vercel Preview only and `http://localhost:*` in development only. Production leaves the preview suffix out because previews share its `sokosumi.com` cookies. Web no longer runs Better Auth; keep this list aligned with browser origins that call Core `/auth`. CORS remains broader (`https://sokosumi.com` / `https://*.sokosumi.com`); do not widen `trustedOrigins` to match CORS — it is a CSRF allowlist, not general API access control.

Cross-origin calls from the web app require the web deployment to use a hostname that satisfies both checks (e.g. `*.sokosumi.com` in hosted environments).

### Better Auth ID generation

- `src/lib/auth.ts` sets `advanced.database.generateId: "uuid"` so Better Auth–managed rows get UUID-shaped primary keys, consistent with `@sokosumi/database` Prisma models. Do not remove this without aligning the shared schema and any database migrations.

### Authentication Context

`authMiddleware` sets `c.var.authContext` (`AuthenticationContext` in `src/middleware/auth.ts`). It is a union on `actor`: `"user"`, `"coworker"`, or `"sokoBot"`. Do not branch on `actor` in a handler. Pick one helper from the [handler actor menu](#handler-actor-menu-user-scoped-auth). `authMiddleware` lists the credentials it accepts.

### Credit Conversion

Use the credit helpers for converting between cents (stored) and credits (user-facing):

```typescript
import {
  convertCentsToCredits,
  convertCreditsToCents,
} from "@sokosumi/utils";

// Convert stored BigInt cents to user-facing decimal
const credits = convertCentsToCredits(BigInt(1000000000000)); // 1.0

// Convert user-facing decimal to stored BigInt cents
const cents = convertCreditsToCents(1.0); // BigInt(1000000000000)
```

**Note**: Credits use base 10^10 for precision (1 credit = 10^10 cents). Never expose cents in request/response bodies or query parameters; convert at the boundary (see [Credit Handling](#credit-handling)).

### Datetime Schemas

Use the reusable datetime schema for consistent date handling:

```typescript
import { dateTimeSchema } from "@/helpers/datetime";

const schema = z.object({
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});
```

This schema automatically converts Date objects to ISO strings and validates ISO datetime format.

### Sync Route Pattern (Vercel)

For internal async-ack sync routes (immediate `200` response + background execution), use this pattern:

- Always use `waitUntil(...)` from `@vercel/functions` for background work.
- Do not use untracked fire-and-forget (`void` async) for long-running sync jobs.
- Locking must be ownership-safe:
  - `acquireLock` returns an owner token.
  - heartbeat updates `lockedAt` while work is running.
  - `releaseLock` uses compare-and-set (`key` + owner token).
- Add route/service tests for:
  - missing or invalid auth returns `401`
  - active lock returns `409`
  - async-ack returns `200` and starts background work once
  - timeout path keeps lock safety guarantees
  - stale ownership does not unlock a lock owned by another runner

## App-Specific Commands

| Command                                                 | Purpose                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm core:dev`                                         | Start development server on `:8787`                                                                                                                                          |
| `pnpm portless:dev`                                     | Web + Core via portless (repo root; named `https://core.sokosumi.localhost`)                                                                                                 |
| `pnpm portless:core`                                    | Core only via portless (still injects Web's named URL)                                                                                                                       |
| `pnpm core:build`                                       | Build for production                                                                                                                                                         |
| `pnpm --filter @sokosumi/core vercel-build`             | Vercel: `prisma:generate`, build, the bundle check, the schema layout check (`scripts/check-network-layout.mts`), then `prisma migrate deploy`                               |
| `pnpm core:start`                                       | Run production build                                                                                                                                                         |
| `pnpm --filter core lint`                               | Lint core app                                                                                                                                                                |
| `pnpm --filter core write-openapi-snapshot`             | Builds Core's workspace dependencies through turbo, then writes `packages/core-client/openapi-core.snapshot.json` (gitignored) from the in-memory v1 router for `openapi-ts` |
| `pnpm --filter @sokosumi/core-client generate:snapshot` | Runs the snapshot script + regenerates `packages/core-client/src/generated` (no running Core server)                                                                         |
| `pnpm --filter @sokosumi/core-client generate`          | Regenerates the Core client from `http://localhost:8787/v1/openapi.json` (Core must be running)                                                                              |

## Common Patterns

Before adding, changing, or removing a `/v1` route (new route files, OpenAPI definitions, `/{id}` to `/me` migration, operation removal, cursor pagination, job files and links), read [Core route patterns](../../docs/agents/core-route-patterns.md).

**Page reads load ahead of the click.** Web loads a list or detail page's content before the user clicks: on a hover, on a predicted approach, and from back links. For that, web wraps the page's Core reads in `"use cache: private"`. So when you design a `GET` that a Web page renders, make it a pure read: no writes or side effects, and a result that depends only on the caller's session and the request. Keep the reads for the page's first view few, so one cached Web loader covers them (the tasks page's loader is `loadTasksPageData` in `apps/web/src/app/(app)/tasks/utils/tasks-page-data.ts`). The Web half of this rule is "Navigation opens a loaded page, not its skeleton" in [`apps/web/AGENTS.md`](../web/AGENTS.md).

**Note**: New Core data access uses direct Prisma; Network models are reached only through a [Network scope](#network-scope). Shared models use the Core singleton (`import prisma from "@/lib/db/prisma"`) with type-safe includes and flatten helpers. Do not import a default `prisma` from `@sokosumi/database/client` in routes — that module exports `createPrismaClient` (used by `src/lib/db/prisma.ts`, tests, and scripts). Repositories may still appear in legacy services — do not introduce new repository usage in routes.

**Shared Packages**:

- `@sokosumi/database` - Database layer with Prisma client, helpers, and (legacy) repositories. Consumed as TypeScript source and inlined by Core's `tsup` ([ADR 0035](../../docs/adr/0035-database-consumed-from-source.md)); it has no build, so Prisma's real types reach Core and JSON-column writes are checked. Writing `null` into a `Json?` column needs `Prisma.DbNull`.
- `@sokosumi/masumi` - Masumi protocol utilities (hash, agent client, schemas)
- `@sokosumi/soko-bot` - Soko Bot contracts (capabilities, persona, memory, tools). Core owns the control plane (`src/lib/soko-bot/`); the loop runs in a per-bot Vercel Sandbox (`src/soko-bot-runner`). The runner calls Core at `/v1/soko-bot-runtime` (`src/routes/v1/soko-bot-runtime`). In-process is the evaluation adapter. There is no `apps/soko-bot` deployable.

**Soko Bot turn lifecycle.** Read [the lifecycle reference](docs/soko-bot-turn-lifecycle.md) before reviewing, debugging, or changing turn startup, cancellation, reconciliation, runtime fences, or watchdog recovery.

**Path Aliases**: The codebase uses `@/` path aliases configured in `tsconfig.json`:

- `@/helpers/*` → `src/helpers/*`
- `@/lib/*` → `src/lib/*`
- `@/routes/*` → `src/routes/*`
- `@/schemas/*` → `src/schemas/*`

### Testing (Vitest)

Place `foo.test.ts` next to `foo.ts` (route handlers: `post.test.ts` beside `post.ts`). Use `__tests__/` only for tests that do not map 1:1 to a source file.

Environment variables required by Vitest (or by code under test) must be set in **`src/test/setup.ts`**. Add new keys to the `envDefaults` object there so tests run with predictable values and without relying on `.env`. Do not add test-only env vars to `.env.example`; keep them in the test setup.

The `unit` Vitest project runs with `isolate: false` and files in random order (`vitest.config.ts`); the `integration` project (`*.integration.test.ts`, real databases when their env is set) keeps per-file isolation. A unit worker runs many files in one process: `src/test/reset-per-file.ts` re-evaluates Core's modules and mock factories for each file, and at the end of each file restores real timers, unstubs globals and env, and puts evlog's `initLogger` config back to a fresh process's. Vitest restores `vi.spyOn` mocks. What it cannot undo is yours to clean up:

- **Await background work.** Code that hands a promise to `waitUntil` or starts it without `await` keeps running after the test. If it imports a module, that import can finish inside the next file, without that file's mocks, and a random later file fails. A test that mocks `waitUntil` mocks it with `vi.fn(…)`, any implementation. After each test, `src/test/wait-until.ts` (installed by `setup.ts`) awaits the promises that mock recorded, even when it threw, in rounds until a round records no new ones (100 rounds at most), so work that background work hands on to `waitUntil` is awaited too. A rejected promise fails the test unless the test declares it with `expectBackgroundRejection(start, times = 1)` from `@/test/wait-until`. The drain does not see a mock written as a plain function or work started without `waitUntil`, and work that never settles makes the hook time out: settle it in `finally`. Work started without `await` and without `waitUntil` is yours to await, or mock the background service.
- **Restore process-wide state yourself** when a later test in the same file depends on it: `process.env` written directly, `globalThis` properties set without `vi.stubGlobal`, listeners on `process`, fake timers.
- **No state in an external package.** Packages under `node_modules` load once per worker and keep their state across files (a client cached by an SDK, a global registry). Reset what you configure; evlog is already handled.

**No unexpected console output.** `src/test/setup.ts` fails a test that writes a `console.error` or `console.warn` it did not declare, and a test that gives either a mock implementation (`vi.spyOn(console, "warn").mockImplementation(…)`), even one restored before the test ends. `console.log` stays allowed. Such output means the test ran something other than production, so fix its cause: a Prisma mock missing a model or method, a fixture production would reject (a row without a required column, bytes that are not an image), a client reaching a real service, a mock with the wrong signature. Only a test whose subject is that error path declares it, with `expectConsole(method, start, times = 1)` from `@sokosumi/utils/test-console`: the message must start with `start` and come exactly `times` times, and the return value holds the matched calls' arguments, so assert the reason or error on them. A library logger that prints a timestamp first takes a `^`-anchored RegExp, matched without terminal colors. Production code on a normal path does not warn: detail of a request belongs on its wide event (`tryUseLogger()?.set(…)`), and work in `waitUntil` runs after that event is emitted, so it records its detail on its own standalone event ([where logs go](#where-core-logs-go)). In tests evlog is silent and every event lands in a test drain (`src/test/core-log.ts`, installed by `setup.ts`, reset per test). Like the console guard, it fails a test that logs a warning or error it did not declare: `log.error`, `log.warn`, `log.fatal`, `logCoreWarning`, or a `setLevel` to warn or error. A test whose subject is that path declares it with `expectCoreLog(level, start, times = 1)` from `@/test/core-log`: every entry whose message starts with `start` counts, the total must be exactly `times` (0 included), and the return value holds the matched entries (`why`, `fix`, `link`, and the drained `event`), so assert on them. `coreLogEvents()` returns every event drained in the test, info events included, for assertions on fields such as a run's counts. A file that calls `initCoreLogger` with its own drain replaces the test drain for its tests. The drain sees events after redaction, as Sentry does. A migrated `console` call swaps its `expectConsole` declaration for `expectCoreLog`; do not mock `@/lib/evlog` to check a log.

**A new required response field breaks distant fixtures.** Many routes `.parse()` their result through the response schema, so a fixture without the new field makes the route answer 500 while typecheck stays clean. The failing test can be in an unrelated file that calls the route as a control case. Grep Core tests for a sibling field of the same schema and update every fixture before you run the suite.

**Keep heavy imports out of every-request modules.** A module that every route loads (middleware that `OpenAPIHonoWithAuth` mounts, shared `@/helpers`) must not import `@/lib/auth` or a route helper at top level. That import pulls Stripe into every suite, and unrelated files fail with `Neither apiKey nor config.authenticator provided` or hook timeouts. Load it with `await import()` inside the branch that needs it, with a comment that says why (`src/middleware/organization.ts`).

**PostgreSQL suites run on both layouts.** CI runs every `*.postgres.test.ts` on today's layout (`Test Core PostgreSQL`) and on the split one (`Test Core PostgreSQL split layout`: tables in `shared`, `mainnet` and `preprod`, Core given those names). A new file must pass on both. Files that cannot yet are in `src/test/split-layout-pending.txt` with the ticket they wait for; the split job runs every other file, then fails when a listed file passes, so delete its line then. The list can grow: until ticket 19 rewrites the trigger bodies, a new test that writes a table with a trigger fails on the split layout only; add its line with that ticket, where review sees it. A file whose tests all skip counts as passing, on both layouts. A test of Preprod behaviour wraps its `describe` in `describe.runIf(onSplitLayout)` (`src/test/split-layout.ts`), because on today's layout Preprod's schema is Mainnet's. Which model belongs to a Network is `packages/database/prisma/network-tables.json`.

**Opt-in Soko Bot reliability suites.** `src/services/soko-bot-*.integration.test.ts` skip unless `LOCAL_RELIABILITY_DATABASE_URL` names a disposable PostgreSQL at `127.0.0.1:55439` with a database name the file allows (`soko_reliability_verified`); the native-table suites are in [docs/native-tables.md](../../docs/native-tables.md). CI runs neither, so they can already fail on `main`: compare failing test names with a `main` run before you blame your diff.

A failure that comes and goes with the order: the log prints `Running tests with seed "<seed>"`. Replay it with `pnpm --filter core test --sequence.seed=<seed>`; add `--maxWorkers=1` to make the whole order deterministic. `--detectAsyncLeaks` names files that leave work running. A run that selects an opt-in PostgreSQL or integration file keeps per-file isolation and its file order.

## Core API Gotchas

### Authentication

- `OpenAPIHonoWithAuth` applies `authMiddleware`. Do not add it again with `app.use`.
- Session cookies must be forwarded with requests (`credentials: "include"`) and rely on the Better Auth handler configuration documented above
- Read the actor through the handler actor menu helpers, not `c.var.authContext` directly
- Coworker and Soko Bot tokens may only `GET` `/users/{id}`, its `/credits`, `/organizations`, `/organizations/{id}/credits`, `/workspaces`, and `/workspaces/preferred` (`src/routes/v1/users/user-coworker-route-allowlist.ts`); every other `/users` route answers them 403. Both workspace reads skip the context binding and narrow their result instead (`AGENT_SELF_FILTERING_USER_SUBPATH_PATTERNS`). Mounting a new user route for agents means extending that allowlist
- API-key and OAuth requests set `organizationId: null` (`src/middleware/auth.ts`), so `workspaceMiddleware` resolves their personal workspace. To widen an owner-only write to organization members, filter `ownerId` OR `workspaceId`; a `workspaceId` filter alone locks those callers out of their organization's rows. Web can gate the same action separately (`readOnly` in `load-job-details.ts`), so check the loader too

### Error Handling

- Error helpers return an `HTTPException`; `throw` it
- Always provide clear, user-facing error messages
- Global error handler formats all errors consistently

### Response Format

- All success responses use `data` + `meta` structure
- All error responses use `error` + `message` + `meta` structure
- Don't create custom response formats

### Credit Handling

- Credits are stored as BigInt cents (base 10^10)
- **Never expose cents in the API**: request/response and query params use credits only; convert at the boundary with `convertCentsToCredits()` / `convertCreditsToCents()` from `@sokosumi/utils`
- Always use `convertCentsToCredits()` when returning credit values to users
- Use `convertCreditsToCents()` when storing user-provided credit values
- Take absolute value when displaying credits: `Math.abs(convertCentsToCredits(amount))`

### Prisma Transactions

- Do **not** use interactive `prisma.$transaction(async (tx) => …)` on read-only GETs — pass default `prisma` instead (see [Interactive Transactions](#interactive-transactions-avoid-on-read-only-gets))
- Interactive txs hold a pool connection for the whole callback; parallel page loads cause **P2028** (`maxWait`)
- Never `Promise.all` queries inside an interactive transaction (#2559)
- Batch form `prisma.$transaction([...])` is fine for independent reads that need one round trip

### Network scope

Mainnet and Preprod get one schema each beside `shared`; a Network model is one listed under `network` in `packages/database/prisma/network-tables.json` (Agent, Job, credits, payments). New code reaches a Network model only through a Network scope ([ADR 0081](../../docs/adr/0081-network-models-are-reached-through-a-network-scope.md)); code that touches only shared models keeps the default `prisma`.

- **Get the scope from the entry point.** In a handler on `OpenAPIHonoWithAuth`: `c.var.networkScope`, set by `networkScopeMiddleware` beside `authContext`; a fixture that builds request variables by hand uses `testNetworkScope()` from `@/test-fixtures/network-scope`. A cron declares its Network where it is registered, as `network` in the options of `handleSyncRequest` (`src/routes/sync/handler.ts`), and reads `context.scope`; without the option its run context has no scope, and it reaches shared models only. Elsewhere the entry point creates it once with `createNetworkScope(network)` from `@/lib/db/network-scope`, naming the Network. Code below takes the scope, or one side of it, as an argument, with no default.
- **`scope.networkDb`** has the Network models and tagged raw SQL; **`scope.sharedDb`** has every other model. A call on the wrong side fails typecheck. Neither opens a transaction itself.
- **A transaction comes from the scope:** `scope.netTransaction(callback, conflictMessage, isolationLevel?)` on the Network's client, `scope.sharedTransaction(…)` on the shared one, both with the retry and conflict rules of `retriedTransaction` (`src/lib/db/transaction.ts`), so the callback can run up to 8 times. A write on both sides opens on the side with more model writes and writes the other side in raw SQL: the Task charge (`src/helpers/task-credits.ts`) takes the scope and the open shared-side transaction, and the credit bucket repository writes its Network's rows. Inside a callback use `tx`, not `scope.networkDb` or `scope.sharedDb`: those run outside the transaction and take a second connection from the one pool while the first is held, which under load leaves every request waiting (`P2028`).
- **A helper takes `NetworkDb` or `SharedDb` whole**, not a `Pick` of it: the Network side is branded in its type, and a `Pick` lets the default client in again.
- **Raw SQL in scoped code** names Network tables with `scope.networkTable("Job")` and shared ones with `sharedTable(…)`.
- **Unit tests** pass a plain object with the members the code uses, cast once to `NetworkScope`, `NetworkDb` or `SharedDb`; no module mock. `scope.networkDb` throws under a `@/lib/db/prisma` mock that has only a default export.
- **Prove a Network read on PostgreSQL**, where the split layout puts the Network's tables in another schema than the default client's: `src/routes/v1/credit-costs/get.postgres.test.ts` is the pattern.
- Old code still calls Network models on the default client; it moves cluster by cluster. `networkPrisma` in `src/lib/db/prisma.ts` is for the scope module only (Biome's `noRestrictedImports` in `biome.json`).

### Raw SQL

- Raw SQL names the schema of every table and enum type it uses: `sharedTable("task")`, `netTable(network, "Job")`, `sharedType("TaskStatus")` and `netType(network, "AgentStatus")` from `@sokosumi/database/sql-tables` ([database package rules](../../packages/database/AGENTS.md)). The clients share one pool and the tables leave `public`, so a bare name leans on the search path. New raw SQL uses the helpers.
- `src/lib/db/prisma.ts` configures the helpers from `DATABASE_SCHEMA_*` and `NETWORK_PREPROD_ENABLED` when it loads, so they name the schemas the clients name.
- The helpers' name arguments are typed from `packages/database/prisma/network-tables.json`, so a misspelled name, a name of the other side, or a table where an enum goes fails the caller's typecheck. A name held in a variable needs that type too (`SharedTableName`, `NetworkTableName`, `SharedEnumName`, `NetworkEnumName`).
- `src/lib/db/__tests__/unqualified-raw-sql.test.ts` reports bare table names. It is advisory: it fails nothing.
- `Test Core PostgreSQL split layout` fails on a bare table or type name in raw SQL under the paths in `SOURCE_PATHS` ([`scripts/prepare-raw-sql.ts`](scripts/prepare-raw-sql.ts)). Add a path there when its raw SQL is qualified.

### File/Blob Resources

- Files have different behaviors based on `origin`:
  - `INPUT` files require `fileUrl` (uploaded to storage)
  - `OUTPUT` files require `sourceUrl` (external URLs from agent results)
- Files are scoped to users and jobs
- Always verify user ownership before returning file data
- Do not fetch the same public Blob URL on every request. Vercel's firewall answers a burst of server reads of `*.public.blob.vercel-storage.com` with `403` and `x-vercel-mitigated: challenge`, while curl from the same machine still gets `200`, so the value vanishes now and then without an error. Cache reads of content-addressed files (`readDesignMdContent` caches by URL) or store the derived value in the database.

### Composio tools

- Read a toolkit's real contract from the API before coding against it, not from Composio's docs or a summary of them: those miss tools and get casing and units wrong. `GET https://backend.composio.dev/api/v3/tools?toolkit_slug=<slug>&limit=500&toolkit_versions=latest` lists the tools, and `GET …/api/v3/tools/<SLUG>?toolkit_versions=latest&version=latest` gives `input_parameters` and `output_parameters`. Without `toolkit_versions=latest` the list is an old base set. Make test fixtures match `output_parameters`.

### Soko Bot turns

- A bot runs one foreground turn at a time: starting another while one runs throws `SokoBotTurnInProgressError` (`soko-bot-control-plane.service.ts`). Work that must follow a turn, such as a plan after research, cannot start inside it; start it when the turn settles.

## Additional Rules

- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – import from the canonical package; no passthrough re-export modules
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – shared pure helpers in `@sokosumi/utils`; Prisma-backed logic in `@sokosumi/database`

## Coworker integrators

Vendor workspace grants gate coworker access beyond assignee/vendor-sibling
baseline. **`GRANT_PENDING`** parks delegated creates until a human approves.

**Read first:** [`docs/coworker/vendor-workspace-grants-api.md`](../../docs/coworker/vendor-workspace-grants-api.md)

Coworker **early access** (human pick/use of non-whitelisted coworkers in a
workspace) is a separate axis — see
[`docs/coworker/coworker-workspace-access-api.md`](../../docs/coworker/coworker-workspace-access-api.md).

Key implementation files:

- `src/helpers/vendor-grants.ts` — grant request, unpark, error kinds
- `src/helpers/access-control.ts` — coworker read/collaboration/comment gates; human workspace usability
- `src/helpers/coworker-workspace-access.ts` — propose / approve / deny / revoke early access
- `src/routes/v1/tasks/*` — list, create, mutations
- `src/schemas/task.schema.ts` — OpenAPI task fields (`grantResumeStatus`, `pendingVendorGrantId`)
- `src/schemas/coworker-workspace-access.schema.ts` — early-access DTO

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Hono Documentation](https://hono.dev/)
- [Hono Node.js Server](https://hono.dev/getting-started/nodejs)
- [Better Auth Hono Integration](https://www.better-auth.com/docs/integrations/hono#middleware)

[Sokosumi evlog constraints](#sokosumi-evlog-constraints) below override this generated evlog block wherever they disagree (HTTP error responses use `@/helpers/error`, not `createError`; no `log.audit` without a ticket).

<!-- evlog:start -->
## Logging with evlog

This project uses [evlog](https://evlog.dev). Follow these rules when you add or change logging.

**One wide event per operation.** A request, a job, a user action — each produces exactly one
event carrying everything about it. Not one log line per step.

- Get the request logger with `c.get('log')` or `useLogger()` from `evlog/hono` inside a route handler.
- Add context as you learn it: `log.set({ user: { id, plan }, cart: { items, total } })`.
- Group related fields into objects. Never flat abbreviations like `{ uid, n, t }`.
- Never pass a raw body — `log.set({ user: body })` leaks passwords. List fields explicitly.
- Do not time anything by hand; the duration is computed when the event emits.
- `log.debug()` is for step detail and is stripped from production builds.

**Errors are structured, never bare.**

```ts
throw createError({
  message: 'Payment failed',
  status: 402,
  why: 'Card declined by the issuer',
  fix: 'Use a different payment method',
  internal: { correlationId },   // drains only — never reaches the client
})
```

Never `throw new Error(...)`. Never `console.error(e); throw e` — use `log.error(e)`.
When the same error appears in three or more places, promote it to `defineErrorCatalog()`.

**Sensitive actions get an audit trail.** Call `log.audit({ action, actor, target, outcome })`
on anything that changes permissions, money, or personal data. Audit entries are never sampled.

**Never log** passwords, tokens, API keys, full card numbers, or session JWTs. Redaction is on
in production, but it is a safety net — not a substitute for choosing the fields yourself.

Check coverage with `npx @evlog/cli map --no-write`. Diagnose setup with `npx @evlog/cli doctor`.
Deeper guidance is in the `review-logging-patterns` skill — read it before a logging change.
<!-- evlog:end -->

## Sokosumi evlog constraints

The evlog block above is the generic convention. This app narrows it:

- Wide events come from Hono `evlog()` middleware (`src/lib/evlog.ts`, mounted in `src/index.ts`). Do not add per-handler `useLogger()` / `log.set` unless a ticket asks for a hot-path field.
- Do **not** use `createError` from evlog in HTTP responses. The public envelope is `error` / `message` / `kind` / `meta.requestId` via `@/helpers/error`.
- Redaction (`CORE_REDACT` in `src/lib/evlog.ts`) runs before console output and every drain, in every environment: it first turns the event into bounded, acyclic JSON data (cut at 16 levels, cycles marked), then masks bearer tokens, IBANs, card numbers, emails, IPv4 addresses, phone numbers and JWTs (Core's copies of evlog's built-ins, in evlog's order) and env secrets by value as Sentry's `beforeSend` does; evlog's `secrets` built-in replaces values under keys ending in `password`, `secret` or `token`. Anything below the depth limit is replaced, never passed through. It is a net, not a reason to log a raw body.
- Identity is already on the event (auth/workspace middleware + `createAuthMiddleware` in `src/lib/evlog-better-auth.ts`). Cookie identify is `user.id` / `userId` and masked `user.email` (`session: false`, `fields: ["id", "email"]`). Skip `/auth/**`, `/sync/**`, and any request with an `Authorization` header (bearer / API key / coworker / orchestrator).
- Do **not** add `log.audit` unless a ticket asks for an audit trail (see `build-audit-logs`).
- Skills: `apps/core/.agents/skills/review-logging-patterns`, `build-audit-logs`, `analyze-logs`. `analyze-logs` reads `.evlog/logs/`; this app drains to stdout and Sentry Logs, not the filesystem.
- Do not run `evlog agents` at the repo root. Re-run from `apps/core` with `--no-skills`.
- CLI is a Core devDependency (`@evlog/cli` 0.13.0). From Core: `pnpm exec evlog map --json --no-write`, `pnpm exec evlog doctor`. Do not add a CI map gate until the CLI credits Hono `app.use(evlog())`.

### Where Core logs go

Core production code logs warnings and errors through evlog, never `console`. The only `console` line left is the local development banner in `src/index.ts`. Biome's `noConsole` enforces this: it is an error in `src/**`, the runner included, and off for `*.test.ts`, `src/test/**` and `scripts/**` (`apps/core/biome.json`). The banner's `biome-ignore` is the only one; do not add another.

- **Inside a request, cron routes included:** on the request's wide event, from `tryUseLogger()`: `log.error(…)`, `logCoreWarning(log, …)`, or a field with `log.set(…)`.
- **After the response (`waitUntil`) and in background work:** a standalone event from `createCoreLogger({ operation, …context })`, then `log.emit()`. The request's event is already emitted; anything set on it there is dropped.
- **Outside any request** (startup checks in `config/env.ts`, the `soko-bot-runner` process): a standalone `createCoreLogger` event too. `config/env.ts` imports `@/lib/evlog-init`, which starts the logger before the first check runs: modules that read the environment while loading run it before `src/index.ts`'s own code. The runner calls `initCoreLogger()` itself. The sandbox has no Sentry, and the runner's output goes to the sandbox's stdout, which nothing reads. So the runner hands its supervisor a diagnostic over IPC (`reportRunnerEvent`), and the supervisor carries it in its immediate failure report (`POST /v1/soko-bot-runtime/turns/{turnId}/fail`, `diagnostic`). Core logs it once per turn, before it stops the sandbox: the report that fails the turn claims the live turn's `runnerDiagnosticAt` in the same locked transaction that appends `turn.failed` (an atomic update on the turn row, which outlives the session's events), so no duplicate can settle the turn in between. A cancelled, settled or already claimed turn logs nothing. Supervisor and Core check it with the same `runnerDiagnosticSchema`. A diagnostic is an event name from `RUNNER_LOG_EVENTS` (`src/lib/soko-bot/runner-log-events.ts`, where Core owns the words) plus closed-set fields, never text, because user code in the sandbox can call `/fail` too. A new runner event gets an entry there.
- **Code that runs both ways** (a service a route awaits and a cron also runs): `recordCoreError` / `recordCoreWarning` from `@/lib/evlog` write on the request's event while it is live (`tryUseLiveLogger`) and emit a standalone event otherwise. Known background work stays standalone even while its request is live, because `waitUntil` work starts before the request's event is emitted. Start any `waitUntil` work that reaches mixed-context code inside `runAsBackgroundWork` (`src/routes/sync/handler.ts` for every cron sync, the chat mention dispatch in `src/routes/v1/chats/rooms`): `tryUseLiveLogger`, and with it `recordCore*` and the library loggers, returns no request logger there. Call `emitCoreError` / `emitCoreWarning` directly only for an event that is standalone by design.

Put IDs in id-named fields (`id`, `taskId`, `taskIds`, `workspace_id`): redaction keeps a valid UUID whole only there, and masks its digit runs as card or phone numbers anywhere else, messages included.

One standalone event per operation: a run's counts go on one event at its end; a failure that the run survives is its own error event with the context of that item (`src/services/stripe-customer-sync.service.ts`).

Every cron run sends one such event from `handleSyncRequest` (`operation: "cron_sync"`): its lock key, outcome, duration and lock release, and the error a sync throws. The handler starts the run with `runAsBackgroundWork(…, { syncRunId })`, so every standalone event the run causes (`createCoreLogger`, `emitCore*`, `recordCore*` and the library loggers, in its services and in background work it starts) carries the same `syncRunId`; overlapping runs keep their own, and events outside a run have none. Each route declares that error's detail: `{ errorDetail: "cause" }` only when every call it makes carries ids, counts, dates and enum values (a Prisma validation error quotes its call's arguments, so a write of registry, catalog, customer or other external text rules it out), else `{ errorDetail: "safe-fields" }` (the default). `captureExternalServiceError` takes the same `errorDetail`, also `safe-fields` by default. `cause` is only for Core's own database calls whose arguments are ids, counts, dates and enum values. A provider API response is untrusted, and its SDK copies the response's message into the error it throws, so a provider call never opts into `cause`. A cron route puts its counts there with `context.log.set({ result })` and a warning it survives with `logCoreWarning(context.log, …)`; its own events get `syncRunId` without passing it. It never logs a "started" or "completed" line.

### Understandable events

Every warning or error Core logs answers three questions, built on evlog's structured error:

- `message`: what happened, one plain sentence, no ids or raw error text.
- `why`: the cause, when known, as a fixed sentence Core writes ("Gmail rejected marking the mail as read"). Never a provider's or library's error text such as `getErrorMessage(error)`: that text goes only into `cause`, where redaction runs.
- `fix`: what to do, only when someone can act on it. `link`: a runbook, only when one exists.
- Raw detail (ids, stack, provider response) goes in event fields, in `cause`, or in `internal`; never in `message` or `why`.
- Mail and message content: for an error that can quote a mail, message or prompt (Composio mail tools, chat dispatch, unfurls, AI calls on user text), log only provider, operation and status code, never the error text or a response body: no `cause`, and `failure: messageSafeErrorFields(error)` from `@/lib/safe-error-fields` as a field. It keeps only names, codes, statuses and operations from Core's own allowlists, and never throws.

On `/auth/*`, a Better Auth warning or error with `Error` arguments logs at warn when each argument of that type is a `StateError` without a cause and with code `state_mismatch` (including expired state) or `state_security_mismatch`. A warning or error without an `Error` argument moves to info only when the response is a 3xx without a new session cookie and its `Location` matches the origin and path of the configured `errorURL` or the error URL Better Auth validated at sign-in and parsed from OAuth state. The `Location` must have a single allowlisted `error` query parameter. A successful redirect that issues no session cookie can also meet this rule, such as account linking to an error page with an allowlisted `error`.

An error is `log.error(createError({ message, why, fix, link, cause, internal }), fields?)`, or on a standalone event `emitCoreError(context, { message, why, fix, cause }, fields?)`. A warning is `logCoreWarning(log, { message, why, fix, link, cause, details }, fields?)` from `@/lib/evlog`, or `emitCoreWarning(context, warning, fields?)`, which keeps each warning's `why`, `fix`, `cause` and `details` under the event's `warnings`. `fields` merge at the event's root, so when one event can hold several warnings of the same kind (a lookup per account), put each one's ids and failure fields in its `details`. Pass the caught error as `cause` as it is; a rejected string is kept as an `Error`. Tests read it with `causeMessage(entry.cause)` from `@/test/core-log`. `betterAuthLogger` and `composioLogger` in `src/lib/evlog-library-logs.ts` apply their severity rules, remove URL queries and fragments, and tag messages with their `source`. They write to the request's wide event while it can still take writes (`tryUseLiveLogger`) and emit a standalone event otherwise. A test that builds its own Better Auth or Composio instance passes the same logger; a file that configures Composio's process-wide SDK logger calls `restoreComposioSdkLoggerAfterFile()` from `@/test/composio-sdk-logger`, which puts back the level and sink the file found.
