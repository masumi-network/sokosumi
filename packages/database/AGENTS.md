# Database Package Agent Guidelines

> **Purpose**: This document provides guidelines for AI agents working on the `@sokosumi/database` package. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/database`
**Purpose**: Shared database layer providing Prisma client factory, repositories, helpers, and types
**Runtime**: Node.js 26.x
**Location**: `packages/database/` within the pnpm workspace

## Layout

The live tree is `src/`. Package exports are in `package.json`.

- `src/client.ts` is `createPrismaClient`
- `src/repositories/` are legacy data-access modules. Pass the Prisma client in.
- `src/helpers/` is Prisma-backed domain logic
- `src/types/` is shared types
- `prisma/` is schema and migrations

## Entry Points

The package provides multiple entry points for different use cases:

### Main Export (`@sokosumi/database`)

- **Purpose**: Prisma model types, enums, and shared types for server packages
- **Includes**: Prisma namespace, model types, enums, shared types
- **Excludes**: PrismaClient (use `@sokosumi/database/client`)
- **Use in**: Core and server packages that own DB access. **Web must not import `@sokosumi/database`** — use generated Core DTOs instead.

```typescript
import { Prisma, Agent, User, Job } from "@sokosumi/database";
```

### Client Export (`@sokosumi/database/client`)

- **Purpose**: Factory function to create Prisma client instances
- **Includes**: `createPrismaClient(poolOrUrl: string | Pool, options?: PrismaClientPoolOptions)` and `PrismaRaw` (client Prisma namespace for tagged SQL)
- **Use in**: Server-side code only

Connection-string callers receive TCP keepalive with a 10-second initial delay.
Supplied pools retain caller-owned configuration and lifetime: Prisma disconnect
does not close them. Options expose `schema` (the schema model queries name, `public` by default) and the `onPoolError` and `onConnectionError` callbacks. Each client on a shared pool adds its own pool `error` listener when given `onPoolError`, so attach that handler to the pool once instead.

```typescript
import { createPrismaClient } from "@sokosumi/database/client";

const prisma = createPrismaClient(process.env.DATABASE_URL);
```

### Repositories Export (`@sokosumi/database/repositories`)

- **Purpose**: Domain repositories (legacy consumers)
- **Use in**: Legacy Core services and other package consumers that still use the repository pattern. New Core routes prefer direct Prisma.

```typescript
import { userRepository } from "@sokosumi/database/repositories";

const user = await userRepository.getUserById("user-id", prisma);
```

### Helpers Export (`@sokosumi/database/helpers`)

- **Purpose**: Prisma-backed domain helpers (job status, credit buckets, billing plan resolution, etc.)
- **Note**: Credit _conversion_ (`convertCentsToCredits` / `convertCreditsToCents`) lives in `@sokosumi/utils`, not here.
- **Credit buckets can activate in the future.** The free plan pre-creates the next period's bucket up to `FREE_SUBSCRIPTION_PRECREATE_LOOKAHEAD_MS` (15 minutes) early. A bucket read that means "current funding" spreads `creditBucketActivatesAtOrBefore(now)` into its `where` (raw SQL: `creditBucketActivatesAtOrBeforeSql`), or it can pick next period's bucket.

```typescript
import { computeJobStatus, mapJobWithStatus } from "@sokosumi/database/helpers";
```

### SQL Tables Export (`@sokosumi/database/sql-tables`)

- **Purpose**: Table and enum type names for raw SQL, always with their schema: `sharedTable(table)`, `netTable(network, table)`, `sharedType(type)` and `netType(network, type)` return `"<schema>"."<name>"` as a `Prisma.Sql` fragment. Raw SQL never relies on the search path for a table or for an enum cast.
- **Argument**: the SQL table name, as the statement would write it (`jobEvent`, not the model `JobEvent`), or the enum's name. `prisma/network-tables.json` decides the side (`networkEnums` for types; every other enum is shared). The arguments are typed from it, as is `NetworkModelName`, the models Core's Network scope offers on its Network side (`src/sql-table-names.ts`, generated: after editing the list run `pnpm --filter @sokosumi/database generate:sql-table-names`; `network-tables.test.ts` fails until you do), so a wrong name fails typecheck. The helpers also refuse it at run time.
- **Preprod**: `netTable("preprod", …)` and `netType("preprod", …)` throw while Preprod is off, so on today's layout no statement can reach Mainnet's rows under Preprod's name.
- **Layout**: `public` for all three and Preprod off until `configureSqlTables(layout)` is called once at startup: Core's `src/lib/db/prisma.ts` calls it from its config, and the data-migration scripts that use raw SQL only (`backfill-task-work-type-presets`, `requeue-empty-company-lookups`) with `sqlTableLayoutFromEnv(process.env)`. A script that also runs model queries does not call it yet: its client names `public`, and raw SQL must name the same schema. `createSqlTables(layout)` builds the helpers for names a test passes. Both refuse a layout Core's `config/network-layout.ts` refuses, and `sqlTableLayoutFromEnv` reads the variables as Core does (`apps/core/src/lib/db/__tests__/sql-table-layout.test.ts` keeps them together).
- **Tests restore what was there.** `configureSqlTables` returns a function that puts back the layout configured before: `onTestFinished(configureSqlTables(layout))`. Never restore a layout you wrote down yourself.
- **Temporary tables no longer shadow.** A test that isolated a statement behind `CREATE TEMP TABLE workspace …` now reads the real table, because the statement names its schema. Give the function under test its tables instead: `backfillTaskWorkTypePresets` takes `tables` in its options, and its test passes a `sharedTable` that names `pg_temp` (`apps/core/src/services/task-work-type-presets.postgres.test.ts`).
- **This package's statements** name Mainnet (`netTable("mainnet", …)`) until their callers pass a Network.
- **Check**: `apps/core/src/lib/db/__tests__/unqualified-raw-sql.test.ts` reports unqualified table names in this package, Core and the scripts. It is advisory: it fails nothing yet. Its header lists what it cannot see and the files it leaves out.

```typescript
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";

await tx.$queryRaw`
  SELECT j.id FROM ${netTable("mainnet", "Job")} j
  JOIN ${sharedTable("workspace")} w ON w.id = j."workspaceId"`;
```

### Job Types Export (`@sokosumi/database/types/job`)

- **Purpose**: Job include/payload types without pulling the full package surface when needed as a subpath

```typescript
import type { JobWithEvents } from "@sokosumi/database/types/job";
```

## Key Conventions

### Repository Pattern

All repositories follow a consistent pattern:

1. **Accept Prisma client as last parameter**: Every method requires explicit client
2. **Return Prisma types**: Use generated Prisma types for consistency
3. **No business logic**: Repositories only handle data access
4. **Use includes**: Define relationship includes as constants

```typescript
export const userRepository = {
  async getUserById(id: string, prisma: PrismaClient): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },
};
```

### Type Definitions

- Leverage Prisma type inference when possible
- Define custom types in `src/types/` for complex relationships
- Export types from the main entry point for Core and server packages

### Primary keys and UUIDs

- **`@default(uuid(7))`**: Primary keys on `String` ids use Prisma’s UUID v7 default for new rows when no `id` is provided. Do not switch back to `cuid()` or plain `uuid()` without an explicit migration and product decision.
- **`@db.Uuid`**: `Workspace.id`, `Job.workspaceId`, and `Task.workspaceId` use native PostgreSQL `UUID` where the database has been migrated. Do not drop `@db.Uuid` (or change those columns to untyped `text`) without a coordinated SQL migration.
- **Better Auth**: Core's Better Auth config (`apps/core/src/lib/auth.ts`) sets `advanced.database.generateId: "uuid"` so adapter inserts use UUID-shaped ids compatible with these columns. Keep Prisma defaults and Better Auth `generateId` aligned when changing either.
- **Legacy data**: Bulk rekey or type-change migrations are separate from schema defaults; see migration history and team runbooks before altering id strategy for existing rows.

### Migrations

- Create migrations with `pnpm prisma:migrate:dev`
- Migration files are in `prisma/migrations/`
- Use descriptive migration names
- **Mirror hand-written SQL in the schema.** Every index, unique, and constraint a migration creates gets a declaration in `schema.prisma` under the same `map:` name; partial uniques use `@@unique([...], map: "...", where: { ... })`. Only what Prisma cannot express (CHECKs, expression indexes) stays SQL-only, with a comment on the model saying so.
- **Drift shows up as unrelated drops.** When `migrate dev` generates `DROP INDEX`, `DROP CONSTRAINT`, or `RENAME CONSTRAINT` for objects your change never touched, the schema has drifted: declare those objects (bullet above) and regenerate, so the migration holds only your change. `pnpm prisma:check-drift` against a database with every migration applied (a scratch Postgres after `pnpm prisma:migrate:deploy`) prints the drift SQL and exits 2; Test Core PostgreSQL runs it.
- **One timestamp per folder, after the current tip.** Prisma orders folders by the 14-digit prefix (`YYYYMMDDHHMMSS`) and applies an older-dated pending folder without warning, so a stamp below `main`'s newest migration runs in a different order on fresh databases than in production. Take a fresh stamp above the tip instead of a round `YYYYMMDD120000` another PR may share. Test Packages fails a PR that adds a folder without a stamp or stamped at or below the newest one on its base branch (usually `main`), or that deletes or renames a folder the base has. The check does not run again when a PR's base branch changes, so push again after you change it. A folder only the PR has can take a fresh stamp, because production never applied it. If the PR's Preview already applied the old name, comment `/reset-db <network>` on the PR. Applied folders keep their names forever, because renaming one re-runs its SQL; to undo one, add a new migration. The historical collisions are allowlisted in `src/helpers/migration-prefix-uniqueness.ts`.
- **Vercel (Core):** `pnpm vercel-build` runs this package’s `prisma:generate`, then Core `tsup`, then `prisma migrate deploy` (Production and Preview). Order is generate-and-compile then migrate (do not migrate if the app fails to compile). Core’s `tsup` inlines this package from source (`noExternal`) and keeps `pg` / `@prisma/client` / `@prisma/adapter-pg` external. Prisma CLI prefers `DATABASE_URL_UNPOOLED` (injected by the Vercel Neon integration), then `DATABASE_URL`. `prisma.config.ts` runs `checkMigrateDeployEnv` only for DB-mutating CLI commands (`migrate …`, `db …`): Preview without `DATABASE_URL_UNPOOLED` fails closed (including raw `prisma migrate deploy`); other Vercel envs warn if unpooled is missing. `prisma generate` skips the preflight. `prisma:migrate:deploy` runs the CLI through `scripts/migrate-deploy.ts`, which runs it again up to 4 times (after 5, 10, 20 and 30 s) when Prisma reports P1001 (database not reachable); a database that stays down fails about 65 s later than before. Web Vercel installs use `pnpm install --frozen-lockfile --filter web...` and never install this package.
- **A migration runs under the previous Core release.** `migrate deploy` runs at the end of the build, and the previous deployment keeps serving until the new one activates, so every migration must be correct under the code already on production. A data migration that needs new code (it moves rows the old code would mishandle, or rows the old code keeps writing in the old shape) ships in a later PR, merged once that code is live, or as a `data-migration:<name>` script run after the deploy. #7108 and #7117 (SOKD-177) are the worked split.
- **Prove it applies** on a throwaway PostgreSQL or a production-data branch before merging a non-trivial migration: [`docs/agents/migrations.md`](../../docs/agents/migrations.md).
- **Data and concurrency.** A migration or helper that moves credits, or writes based on another row's state, follows Data and Concurrency in [`docs/agents/coding-conventions.md`](../../docs/agents/coding-conventions.md): lock what you checked, and prove money races on PostgreSQL.

## Package-Specific Commands

| Command                                   | Purpose                                           |
| ----------------------------------------- | ------------------------------------------------- |
| `pnpm --filter @sokosumi/database lint`   | Lint package code                                 |
| `pnpm --filter @sokosumi/database format` | Format code with Biome                            |
| `pnpm prisma:generate`                    | Generate Prisma client                            |
| `pnpm prisma:migrate:dev`                 | Create new migration                              |
| `pnpm prisma:migrate:deploy`              | Apply migrations (production / Core Vercel build) |
| `pnpm prisma:migrate:reset`               | Reset database (dev only)                         |
| `pnpm prisma:studio`                      | Open Prisma Studio                                |

## Usage in Apps

**Only Core** creates a Prisma client (`apps/core/src/lib/db/prisma.ts`). Web must not import `@sokosumi/database` or create a client — it reaches data through the Core API.

Core's singleton owns one `pg.Pool`, preserves TCP keepalive, attaches Vercel's idle
connection cleanup, and reports adapter errors to Sentry. On that pool it builds
the `shared` client (the default export) and one client per Network, each naming
its schema from `DATABASE_SCHEMA_*`. Shared models use the default export; Network
models are reached only through a Network scope
([Core](../../apps/core/AGENTS.md#network-scope)). Do not construct additional
pools there.

```typescript
import prisma from "@/lib/db/prisma";
```

## Best Practices

### ✅ Do

- New Core data access uses direct Prisma; Network models are reached only through a Network scope (see [core AGENTS](../../apps/core/AGENTS.md#network-scope); shared models: `import prisma from "@/lib/db/prisma"`)
- Keep repositories for package consumers / legacy Core services that still use them; pass Prisma client explicitly
- Import types from the main export (`@sokosumi/database`) in Core and server packages
- Use database helpers for Prisma-backed domain logic (job status, credit buckets); use `@sokosumi/utils` for credit conversion

### ❌ Don't

- Import `@sokosumi/database` from the web app
- Put business logic in repositories
- Access generated files directly
- Use default exports in repositories
- Re-export `@sokosumi/utils` symbols from database helpers

## Troubleshooting

### Build Issues

This package has no build. Core consumes its TypeScript source directly and
bundles it ([ADR 0035](../../docs/adr/0035-database-consumed-from-source.md)),
so there is no `dist` to go stale and nothing to clean. A type error here is a
real type error — do not look for a missing rebuild.

```bash
pnpm --filter @sokosumi/database typecheck
```

### Prisma Client Not Found

```bash
pnpm prisma:generate
```

### Type Errors After Schema Changes

1. Regenerate Prisma client: `pnpm prisma:generate`
2. Restart TypeScript server

## Prisma skills

This package is Prisma 7 (`package.json`). CLI reference: [`.agents/skills/prisma-cli/`](.agents/skills/prisma-cli/). Connection setup and repair for the installed version: [`.agents/skills/prisma-orm-setup/`](.agents/skills/prisma-orm-setup/). Driver-adapter work: [`.agents/skills/prisma-driver-adapter-implementation/`](.agents/skills/prisma-driver-adapter-implementation/).

## Additional Rules

- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – do not re-export `@sokosumi/utils` (or other packages) from helpers
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – pure shared types/parsers live in `@sokosumi/utils`; DB resolution stays in helpers here

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Prisma Documentation](https://www.prisma.io/docs)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
