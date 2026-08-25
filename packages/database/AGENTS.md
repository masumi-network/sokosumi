# Database Package Agent Guidelines

> **Purpose**: This document provides guidelines for AI agents working on the `@sokosumi/database` package. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/database`
**Purpose**: Shared database layer providing Prisma client factory, repositories, helpers, and types
**Runtime**: Node.js 24.x (server-only)
**Location**: `packages/database/` within the pnpm workspace

## Package Structure

```
packages/database/
├── src/
│   ├── client.ts              # Prisma client factory function
│   ├── index.ts               # Main exports (types & models)
│   ├── repositories/          # Repository layer
│   │   ├── agent.repository.ts
│   │   ├── agentList.repository.ts
│   │   ├── agentRating.repository.ts
│   │   ├── blob.repository.ts
│   │   ├── category.repository.ts
│   │   ├── creditCost.repository.ts
│   │   ├── transaction.repository.ts
│   │   ├── invitation.repository.ts
│   │   ├── job.repository.ts
│   │   ├── job-event.repository.ts
│   │   ├── job-input.repository.ts
│   │   ├── job-purchase.repository.ts
│   │   ├── link.repository.ts
│   │   ├── lock.repository.ts
│   │   ├── member.repository.ts
│   │   ├── organization.repository.ts
│   │   ├── sync-metadata.repository.ts
│   │   ├── tag.repository.ts
│   │   ├── user.repository.ts
│   │   ├── utmAttribution.repository.ts
│   │   └── index.ts           # Export all repositories
│   ├── helpers/               # Domain helpers
│   │   ├── credit.ts          # Credit calculation helpers
│   │   ├── job.ts             # Job status computation
│   │   └── index.ts
│   └── types/                 # Shared type definitions
│       ├── agent.ts
│       ├── agentList.ts
│       ├── agentRating.ts
│       ├── invitation.ts
│       ├── job.ts
│       ├── public-share.ts
│       ├── link.ts
│       ├── member.ts
│       ├── organization.ts
│       └── utm.ts
├── prisma/
│   ├── schema/               # Prisma schema files
│   └── migrations/           # Migration history
├── dist/                     # Compiled output (gitignored)
└── package.json
```

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
- **Includes**: `createPrismaClient(databaseUrl: string)` function
- **Use in**: Server-side code only (protected by `server-only`)

```typescript
import { createPrismaClient } from "@sokosumi/database/client";

const prisma = createPrismaClient(process.env.DATABASE_URL);
```

### Repositories Export (`@sokosumi/database/repositories`)

- **Purpose**: Domain repositories (legacy consumers)
- **Use in**: Legacy Core services and other package consumers that still use the repository pattern. New Core routes prefer direct Prisma.

```typescript
import {
  userRepository,
  agentRepository,
} from "@sokosumi/database/repositories";

const user = await userRepository.getUserById("user-id", prisma);
```

### Helpers Export (`@sokosumi/database/helpers`)

- **Purpose**: Prisma-backed domain helpers (job status, credit buckets, billing plan resolution, etc.)
- **Note**: Credit *conversion* (`convertCentsToCredits` / `convertCreditsToCents`) lives in `@sokosumi/utils`, not here.

```typescript
import { computeJobStatus, mapJobWithStatus } from "@sokosumi/database/helpers";
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
- **Better Auth**: Web and Core Better Auth configs set `advanced.database.generateId: "uuid"` so adapter inserts use UUID-shaped ids compatible with these columns. Keep Prisma defaults and Better Auth `generateId` aligned when changing either.
- **Legacy data**: Bulk rekey or type-change migrations are separate from schema defaults; see migration history and team runbooks before altering id strategy for existing rows.

### Migrations

- Create migrations with `pnpm prisma:migrate:dev`
- Migration files are in `prisma/migrations/`
- Use descriptive migration names
- **Timestamps must be unique.** Prisma applies folders by the 14-digit prefix (`YYYYMMDDHHMMSS`), then the rest of the name. Do not reuse a nearby `YYYYMMDD120000` noon stamp from another PR — bump from the current tip. Two historical collisions are allowlisted in `src/helpers/migration-prefix-uniqueness.ts` (already applied in production); do not add a third folder with those prefixes, and do not rename the existing folders.
- **Vercel (Core):** After a successful Core app build, `pnpm vercel-build` runs `prisma migrate deploy` against that deployment’s database (Production and Preview). Order is build-then-migrate (do not migrate if the app fails to compile). Prisma CLI prefers `DATABASE_URL_UNPOOLED` (injected by the Vercel Neon integration), then `DATABASE_URL`. `prisma.config.ts` runs `checkMigrateDeployEnv` only for DB-mutating CLI commands (`migrate …`, `db …`): Preview without `DATABASE_URL_UNPOOLED` fails closed (including raw `prisma migrate deploy`); other Vercel envs warn if unpooled is missing. `prisma generate` (this package’s prepare) skips the preflight. Web Vercel installs use `pnpm install --filter web...` and never install this package. Keep migrations backward-compatible with the previous Core release for the brief window before the new deployment activates.

## Package-Specific Commands

| Command                      | Purpose                       |
| ---------------------------- | ----------------------------- |
| `pnpm database:build`        | Build TypeScript to JS        |
| `pnpm database:lint`         | Lint package code             |
| `pnpm database:format`       | Format code with Biome        |
| `pnpm prisma:generate`       | Generate Prisma client        |
| `pnpm prisma:migrate:dev`    | Create new migration          |
| `pnpm prisma:migrate:deploy` | Apply migrations (production / Core Vercel build) |
| `pnpm prisma:migrate:reset`  | Reset database (dev only)     |
| `pnpm prisma:studio`         | Open Prisma Studio            |

## Usage in Apps

**Only Core** creates a Prisma client (`apps/core/src/lib/db/prisma.ts`). Web must not import `@sokosumi/database` or create a client — it reaches data through the Core API.

```typescript
// apps/core/src/lib/db/prisma.ts
import { createPrismaClient } from "@sokosumi/database/client";

const prisma = createPrismaClient(process.env.DATABASE_URL!);
export default prisma;
```

## Best Practices

### ✅ Do

- Prefer direct Prisma in new Core route handlers (see [core AGENTS](../../apps/core/AGENTS.md); `import prisma from "@/lib/db/prisma"`)
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

```bash
# Clean build cache and dist folder
pnpm --filter @sokosumi/database clean
pnpm --filter @sokosumi/database build
```

### Prisma Client Not Found

```bash
pnpm prisma:generate
```

### Type Errors After Schema Changes

1. Regenerate Prisma client: `pnpm prisma:generate`
2. Rebuild the package: `pnpm database:build`
3. Restart TypeScript server

## Additional Rules

- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – do not re-export `@sokosumi/utils` (or other packages) from helpers
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – pure shared types/parsers live in `@sokosumi/utils`; DB resolution stays in helpers here

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Prisma Documentation](https://www.prisma.io/docs)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
