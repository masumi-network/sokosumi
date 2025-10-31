# @sokosumi/database

Standalone database layer package for the Sokosumi monorepo, providing a clean repository pattern over Prisma with full TypeScript support.

## Overview

This package encapsulates all database access through:

- **Prisma Schema**: Single source of truth for the database structure
- **Repositories**: Domain-specific data access layer
- **Type Exports**: Browser-safe type definitions
- **Transaction Support**: Atomic operations across repositories
- **Helpers**: Domain logic utilities

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
│   ├── client.ts              # Prisma client singleton
│   ├── transaction.ts         # Transaction utilities
│   ├── index.ts               # Main exports (types & models)
│   ├── repositories/          # Repository layer
│   │   ├── agent.repository.ts
│   │   ├── user.repository.ts
│   │   └── ...
│   ├── types/                 # Shared type definitions
│   │   ├── agent.ts
│   │   ├── job.ts
│   │   └── ...
│   ├── helpers/               # Domain helpers
│   │   └── job.ts
│   └── generated/             # Prisma generated files (gitignored)
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Migration history
├── dist/                      # Compiled output (gitignored)
└── package.json
```

## Usage

### Importing Types and Models

```typescript
// Import Prisma types and model types
import { Prisma, Agent, User, Job } from "@sokosumi/database";

// Use in type annotations
type AgentWhereInput = Prisma.AgentWhereInput;
type UserUpdateInput = Prisma.UserUpdateInput;
```

### Using the Prisma Client

```typescript
// Import the Prisma client singleton (server-side only)
import prisma from "@sokosumi/database/client";

// Direct Prisma access (use sparingly - prefer repositories)
const user = await prisma.user.findUnique({ where: { id: userId } });
```

### Using Repositories

```typescript
import {
  userRepository,
  agentRepository,
} from "@sokosumi/database/repositories";

// Get a user
const user = await userRepository.getUserById("user-id");

// Get agents with status filtering
const agents = await agentRepository.getShownAgentsByStatus("ONLINE");
```

### Using Transactions

```typescript
import { transaction } from "@sokosumi/database/transaction";
import { userRepository, jobRepository } from "@sokosumi/database/repositories";

// Execute multiple operations atomically
await transaction.run(async (tx) => {
  const user = await userRepository.getUserById(userId, tx);
  const job = await jobRepository.createJob(
    {
      userId: user.id,
      agentId,
      input: {},
    },
    tx,
  );

  // If any operation fails, all changes are rolled back
});
```

### Using Helpers

```typescript
import { computeJobStatus, mapJobWithStatus } from "@sokosumi/database/helpers";
import type { Job } from "@sokosumi/database";

// Compute job status
const status = computeJobStatus(job);

// Map job to include computed status
const jobWithStatus = mapJobWithStatus(jobWithRelations);
```

### Custom Types

```typescript
import type {
  AgentWithRelations,
  JobWithStatus,
  OrganizationWithRelations,
} from "@sokosumi/database";

// Use in function signatures
async function getAgentDetails(id: string): Promise<AgentWithRelations | null> {
  // ...
}
```

## Entry Points

The package provides multiple entry points for different use cases:

### Main Export (`@sokosumi/database`)

- **Purpose**: Browser-safe types and enums
- **Includes**: Prisma namespace, model types, enums, shared types
- **Excludes**: PrismaClient (Node.js only)
- **Use in**: Client and server components for type annotations

### Client Export (`@sokosumi/database/client`)

- **Purpose**: Prisma client singleton
- **Includes**: Configured PrismaClient instance
- **Use in**: Server-side code only (protected by `server-only`)

### Transaction Export (`@sokosumi/database/transaction`)

- **Purpose**: Transaction utilities
- **Includes**: `transaction.run()` helper, `TransactionClient` type
- **Use in**: Server-side code for atomic operations

### Repositories Export (`@sokosumi/database/repositories`)

- **Purpose**: All domain repositories
- **Includes**: 18+ repository objects
- **Use in**: Server-side services and actions

### Helpers Export (`@sokosumi/database/helpers`)

- **Purpose**: Domain logic utilities
- **Includes**: Job status computation, mapping functions
- **Use in**: Services, actions, API handlers

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

# Apply migrations (production)
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
pnpm run lint:fix

# Format code
pnpm run format

# Check formatting
pnpm run format:check
```

## Architecture

### Repository Pattern

All repositories follow a consistent pattern:

1. **Accept optional transaction client**: Every method accepts `tx?: Prisma.TransactionClient`
2. **Return Prisma types**: Use generated Prisma types for consistency
3. **No business logic**: Repositories only handle data access
4. **Use includes**: Define relationship includes as constants

Example repository structure:

```typescript
export const userRepository = {
  async getUserById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<User | null> {
    return tx.user.findUnique({ where: { id } });
  },

  // ... more methods
};
```

### Three-Layer Pattern

The database package is the foundation of a three-layer architecture:

1. **Repositories** (this package): Data access
2. **Services** (web app): Business logic coordination
3. **Actions** (web app): Server mutations and API handlers

### Type Safety

- All types are generated from the Prisma schema
- The main export uses browser-safe types (no Node.js dependencies)
- Server-side code imports the full client from `/client`
- Transaction types ensure consistency across operations

## Migration Guide

### From Direct Prisma to Repository Pattern

**Before:**

```typescript
import prisma from "@/lib/db/repositories/prisma";

const user = await prisma.user.findUnique({ where: { id } });
```

**After:**

```typescript
import { userRepository } from "@sokosumi/database/repositories";

const user = await userRepository.getUserById(id);
```

### Updating Imports

**Before:**

```typescript
import { Agent } from "@/prisma/generated/client";
import prisma from "@/lib/db/repositories/prisma";
```

**After:**

```typescript
import { Agent } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
// Or better yet, use repositories:
import { agentRepository } from "@sokosumi/database/repositories";
```

## Best Practices

### ✅ Do

- Use repositories for all database access
- Pass transaction client for multi-operation workflows
- Import types from the main export
- Use helpers for domain logic
- Follow the three-layer pattern

### ❌ Don't

- Import Prisma client directly in client components
- Mix direct Prisma access with repositories
- Put business logic in repositories
- Skip transaction for related operations
- Access generated files directly

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

The package uses a `prepare` script to auto-generate the Prisma client:

```bash
pnpm install  # Runs prepare script automatically
```

Or manually:

```bash
pnpm run prisma:generate
```

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

## Contributing

When adding new database entities:

1. Update `prisma/schema.prisma`
2. Create migration: `pnpm run prisma:migrate:dev`
3. Create repository in `src/repositories/`
4. Export repository in `src/repositories/index.ts`
5. Add types to `src/types/` if needed
6. Update this README

## References

- [Prisma Documentation](https://www.prisma.io/docs)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
- [Sokosumi AGENTS.md](../../AGENTS.md)
