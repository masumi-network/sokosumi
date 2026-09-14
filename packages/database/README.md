# @sokosumi/database

Standalone database layer for the Sokosumi monorepo: Prisma schema, client factory, repositories, helpers, and shared types.

**Core owns all database access.** Only Core creates a Prisma client (`apps/core/src/lib/db/prisma.ts`). The web app must not import `@sokosumi/database`, Prisma, or Postgres — it reaches data through the Core API.

## Overview

This package encapsulates database access through:

- **Prisma Schema**: Single source of truth for the database structure
- **Repositories**: Legacy data-access modules (new Core routes prefer direct Prisma)
- **Type Exports**: Prisma models, enums, and shared include/payload types for Core and other server packages
- **Helpers**: Prisma-backed domain logic (job status, credit buckets, billing plan resolution)

Credit conversion (`convertCentsToCredits` / `convertCreditsToCents`) lives in `@sokosumi/utils`, not here.

## Installation

This package is part of the Sokosumi monorepo and uses pnpm workspaces:

```json
{
  "dependencies": {
    "@sokosumi/database": "workspace:*"
  }
}
```

## Package Structure

```
packages/database/
├── src/
│   ├── client.ts              # createPrismaClient factory
│   ├── index.ts               # Main exports (types & models)
│   ├── repositories/          # Legacy repository layer
│   ├── types/                 # Shared type definitions
│   ├── helpers/               # Prisma-backed domain helpers
│   └── generated/             # Prisma generated files (gitignored)
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Migration history
├── dist/                      # Compiled output (gitignored)
└── package.json
```

## Usage

### Importing Types and Models

Use in Core and other server packages that own DB access:

```typescript
import { Prisma, Agent, User, Job } from "@sokosumi/database";

type AgentWhereInput = Prisma.AgentWhereInput;
type UserUpdateInput = Prisma.UserUpdateInput;
```

### Using the Prisma Client

Only Core (and package tests/scripts) should create a client:

```typescript
import { createPrismaClient } from "@sokosumi/database/client";

const prisma = createPrismaClient(process.env.DATABASE_URL);
```

In Core, import the app singleton instead of calling the factory again:

```typescript
// apps/core/src/lib/db/prisma.ts
import { createPrismaClient } from "@sokosumi/database/client";

const prisma = createPrismaClient(process.env.DATABASE_URL!);
export default prisma;
```

```typescript
// Core routes / services
import prisma from "@/lib/db/prisma";

const user = await prisma.user.findUnique({ where: { id: userId } });
```

New Core routes use that singleton directly. Do not import `@sokosumi/database` from `apps/web`.

### Using Repositories

Repositories remain for legacy Core services. Pass the Prisma client explicitly:

```typescript
import { userRepository } from "@sokosumi/database/repositories";
import prisma from "@/lib/db/prisma";

const user = await userRepository.getUserById("user-id", prisma);
```

### Using Transactions

Transactions live in Core (`apps/core/src/lib/db/transaction.ts`), not in this package. For serializable mutations, use `serializableTransaction`. For a simple interactive transaction, pass Core's Prisma client into repositories:

```typescript
import prisma from "@/lib/db/prisma";
import { userRepository, jobRepository } from "@sokosumi/database/repositories";

await prisma.$transaction(async (tx) => {
  const user = await userRepository.getUserById(userId, tx);
  const job = await jobRepository.getJobById(jobId, tx);
});
```

### Using Helpers

```typescript
import { computeJobStatus, mapJobWithStatus } from "@sokosumi/database/helpers";
import type { Job } from "@sokosumi/database";

const status = computeJobStatus(job);
const jobWithStatus = mapJobWithStatus(jobWithRelations);
```

### Named exports (`@sokosumi/database`)

Besides Prisma-generated models and enums, the main entry point currently re-exports:

```typescript
import {
  type AgentWithPricing,
  agentExampleOutputInclude,
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
  agentPricingInclude,
  agentTagsInclude,
  InvitationStatus,
  MemberRole,
  workspaceRelationInclude,
} from "@sokosumi/database";
import type { JobWithSokosumiStatus } from "@sokosumi/database";
```

Agent query shapes used by Core:

- `agentPricingInclude` / `AgentWithPricing`
- `agentTagsInclude`
- `agentExampleOutputInclude`
- `agentMetadataOverrideScalarsInclude`
- `agentOrderBy`

`agentTagsInclude` and `agentExampleOutputInclude` both embed `agentMetadataOverrideRelationsInclude` (tags + example outputs on the override row). Core owns `agentCategoriesInclude` locally — it is not exported from this package.

Job include/payload types (`JobWithEvents`, `jobWithEvents`, …) are also re-exported from `src/types/job.ts`. `InvitationStatus` includes `EXPIRED` for UI/API mapping; that value is not stored in the database.

## Entry Points

### Main Export (`@sokosumi/database`)

- **Purpose**: Prisma model types, enums, and shared types for server packages
- **Includes**: Prisma namespace, model types, enums, named includes/types above
- **Excludes**: PrismaClient (use `@sokosumi/database/client`)
- **Use in**: Core and server packages that own DB access. **Web must not import this package.**

### Client Export (`@sokosumi/database/client`)

- **Purpose**: Factory function to create Prisma client instances
- **Includes**: `createPrismaClient(databaseUrl: string)`
- **Use in**: Core (`apps/core/src/lib/db/prisma.ts`) and server-side tests/scripts (`server-only`)

### Repositories Export (`@sokosumi/database/repositories`)

- **Purpose**: Domain repositories (legacy consumers)
- **Use in**: Legacy Core services. New Core routes prefer direct Prisma.

### Helpers Export (`@sokosumi/database/helpers`)

- **Purpose**: Prisma-backed domain helpers
- **Includes**: Job status, credit buckets, billing plan resolution, and related helpers
- **Use in**: Core services, routes, and other server packages

### Job Types Export (`@sokosumi/database/types/job`)

- **Purpose**: Job include/payload types without pulling the full package surface when needed as a subpath

## Development

### Building

```bash
# Build TypeScript to JavaScript
pnpm run build

# Watch mode for development
pnpm run dev

# Clean build artifacts
pnpm run clean
```

### Database Operations

```bash
# Generate Prisma client
pnpm run prisma:generate

# Create a new migration
pnpm run prisma:migrate:dev

# Apply migrations (production / Core Vercel build)
pnpm run prisma:migrate:deploy

# Reset database (development only)
pnpm run prisma:migrate:reset

# Open Prisma Studio
pnpm run prisma:studio
```

### Code Quality

```bash
# Lint code
pnpm run lint

# Fix linting issues
pnpm run lint:write

# Format code
pnpm run format

# Check formatting
pnpm run format:check
```

## Architecture

### Repository Pattern

All repositories follow a consistent pattern:

1. **Accept Prisma client as last parameter**: Every method requires an explicit client
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

### Data access ownership

1. **This package**: Schema, Prisma client factory, helpers, legacy repositories
2. **Core**: The only app that instantiates Prisma and queries the database
3. **Web**: Consumes Core API DTOs — never this package

### Type Safety

- Relationship payload types are inferred from Prisma includes
- The main export is for Core and other server packages, not the web app
- Server-side code that needs a client imports `@sokosumi/database/client`

## Best Practices

### Do

- Prefer direct Prisma in new Core route handlers (`import prisma from "@/lib/db/prisma"`)
- Keep repositories for package consumers / legacy Core services; pass the Prisma client explicitly
- Import types from the main export in Core and server packages
- Use database helpers for Prisma-backed domain logic; use `@sokosumi/utils` for credit conversion

### Don't

- Import `@sokosumi/database` from the web app
- Put business logic in repositories
- Access generated files directly
- Use default exports in repositories
- Re-export `@sokosumi/utils` symbols from database helpers

## Troubleshooting

### Build Issues

If the build fails or the `dist` folder isn't created:

```bash
# Clean build cache and dist folder
pnpm run clean
pnpm run build
```

**Common cause**: Corrupted incremental build cache (`tsconfig.tsbuildinfo`). The `clean` script removes this automatically.

### No Output Files Generated

If `pnpm run build` succeeds but creates no files:

1. The incremental build cache may be corrupted
2. Delete `tsconfig.tsbuildinfo` and `dist/`
3. Run `pnpm run build` again

This is automatically handled by the `clean` script.

### Prisma Client Not Found

Generate the Prisma client with turbo (`build` / `typecheck` / `test` depend on `prisma:generate`) or:

```bash
pnpm run prisma:generate
```

Core Vercel runs the same `prisma:generate` script from `vercel-build` before `tsc` and `tsup`.

### Type Errors

If you see type errors after schema changes:

1. Regenerate Prisma client: `pnpm run prisma:generate`
2. Rebuild the package: `pnpm run build`
3. Restart your TypeScript server

### Import Errors

Ensure you're using the correct entry point:

- Types: `@sokosumi/database`
- Client: `@sokosumi/database/client`
- Repositories: `@sokosumi/database/repositories`
- Helpers: `@sokosumi/database/helpers`

## Contributing

When adding new database entities:

1. Update `prisma/schema.prisma`
2. Create migration: `pnpm run prisma:migrate:dev`
3. Create repository in `src/repositories/` only if a legacy consumer still needs one
4. Export repository in `src/repositories/index.ts`
5. Add types to `src/types/` if needed
6. Update this README

## References

- [Prisma Documentation](https://www.prisma.io/docs)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
- [Sokosumi AGENTS.md](../../AGENTS.md)
- [Database package AGENTS.md](./AGENTS.md)
