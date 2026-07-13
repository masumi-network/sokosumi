# Masumi Package Agent Guidelines

> **Purpose**: This document provides guidelines for AI agents working on the `@sokosumi/masumi` package. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/masumi`
**Purpose**: Masumi protocol utilities including agent client, hash functions, schemas, types, and Masumi-hosted tool clients
**Runtime**: Node.js 24.x
**Location**: `packages/masumi/` within the pnpm workspace

## Package Structure

```
packages/masumi/
├── src/
│   ├── index.ts               # Main exports
│   ├── clients/               # API clients
│   │   ├── agent.client.ts    # Agent API client factory
│   │   └── index.ts
│   ├── hash/                  # Hash utilities
│   │   ├── hash.ts            # Input/result hashing
│   │   ├── verification.ts    # Hash verification
│   │   ├── index.ts
│   │   └── __tests__/         # Hash tests
│   ├── schemas/               # Zod validation schemas
│   │   ├── agent/             # Agent protocol schemas
│   │   │   ├── availability.schema.ts
│   │   │   ├── input_schema.schema.ts
│   │   │   ├── provide_input.schema.ts
│   │   │   ├── start_job.schema.ts
│   │   │   └── status.schema.ts
│   │   ├── input/             # Input validation schemas
│   │   │   ├── input.schema.ts
│   │   │   ├── validation.schema.ts
│   │   │   └── __tests__/
│   │   └── index.ts
│   ├── types/                 # TypeScript types
│   │   ├── agent.ts           # Agent type definitions
│   │   ├── input-types.ts     # Input type definitions
│   │   └── index.ts
│   ├── tools/                 # Masumi-hosted tool clients
│   │   ├── design-md/         # DESIGN.md generator client
│   │   └── index.ts
│   └── utils/                 # Utility functions
│       ├── result.ts          # Result type (Ok/Err)
│       ├── url.ts             # URL utilities
│       └── index.ts
├── dist/                      # Compiled output (gitignored)
└── package.json
```

## Entry Points

### Main Export (`@sokosumi/masumi`)

- **Purpose**: All package exports combined
- **Includes**: Clients, hash utilities, types, utils

```typescript
import { createAgentClient, hashInput, hashResult } from "@sokosumi/masumi";
```

### Hash Export (`@sokosumi/masumi/hash`)

- **Purpose**: Hash utilities for job verification
- **Includes**: `hashInput`, `hashResult`, verification functions

```typescript
import { hashInput, hashResult, verifyInputHash } from "@sokosumi/masumi/hash";

const inputHash = hashInput(JSON.stringify(inputData), purchaserId);
const resultHash = hashResult(resultString, purchaserId);
```

### Clients Export (`@sokosumi/masumi/clients`)

- **Purpose**: Agent API client
- **Includes**: `createAgentClient` factory function

```typescript
import { createAgentClient } from "@sokosumi/masumi/clients";

const agentClient = createAgentClient({
  onError: (error) => console.error(error),
});
```

### Schemas Export (`@sokosumi/masumi/schemas`)

- **Purpose**: Zod schemas for Masumi protocol
- **Includes**: Agent response schemas, input validation schemas

```typescript
import {
  jobStatusResponseSchema,
  inputSchemaResponseSchema,
} from "@sokosumi/masumi/schemas";
```

### Types Export (`@sokosumi/masumi/types`)

- **Purpose**: TypeScript type definitions
- **Includes**: Agent types, input types

```typescript
import type { Agent, InputSchemaType } from "@sokosumi/masumi/types";
```

### Tools Export (`@sokosumi/masumi/tools`)

- **Purpose**: Clients and helpers for Masumi-hosted tools outside the Masumi protocol APIs
- **Includes**: DESIGN.md generator client, schemas, types, and preview URL helper

```typescript
import {
  buildDesignMdPreviewUrl,
  createDesignMdClient,
} from "@sokosumi/masumi/tools";
```

## Key Features

### Agent Client

The agent client provides methods for interacting with Masumi-compliant agents:

```typescript
const client = createAgentClient({
  onError: (error) => {
    // Handle errors (http_error, json_parse_error, schema_validation_error, network_error)
    console.error(error.type, error.message);
  },
});

// Start a paid job
const result = await client.startPaidAgentJob(agent, purchaserId, inputData);

// Start a free job
const result = await client.startFreeAgentJob(agent, inputData);

// Get job status
const status = await client.fetchAgentJobStatus(agent, jobId);

// Provide additional input
const response = await client.provideJobInput(
  agent,
  statusId,
  jobId,
  inputData,
);

// Get agent input schema
const schema = await client.fetchAgentInputSchema(agent);
```

### Hash Functions

Hash functions for verifying job inputs and results:

```typescript
import { hashInput, hashResult } from "@sokosumi/masumi/hash";

// Hash job input (JSON canonicalization + SHA-256)
const inputHash = hashInput(JSON.stringify(inputData), purchaserId);

// Hash job result
const resultHash = hashResult(resultString, purchaserId);
```

### Result Type

The package uses a Result type for error handling:

```typescript
import { Ok, Err, type Result } from "@sokosumi/masumi";

function doSomething(): Result<string, string> {
  if (success) {
    return Ok("value");
  }
  return Err("error message");
}

const result = doSomething();
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

## Key Conventions

### Error Handling

- Use `Result<T, E>` type for operations that can fail
- Client methods return `Result` instead of throwing
- Error types: `http_error`, `json_parse_error`, `schema_validation_error`, `network_error`

### Schema Validation

- Use Zod for all schema validation
- Schemas match the Masumi protocol specification
- Parse responses with `.safeParse()` for error handling

### URL Handling

- Use `safeAddPathComponent` for URL construction
- Validate agent API base URLs (no query strings, no hashes)
- Support HTTP and HTTPS protocols

## Package-Specific Commands

| Command                                 | Purpose                |
| --------------------------------------- | ---------------------- |
| `pnpm masumi:build`                     | Build TypeScript to JS |
| `pnpm masumi:test`                      | Run tests              |
| `pnpm masumi:test:ci`                   | Run tests in CI mode   |
| `pnpm --filter @sokosumi/masumi lint`   | Lint package           |
| `pnpm --filter @sokosumi/masumi format` | Format code            |

## Testing

Tests are colocated in `__tests__/` directories:

- `src/hash/__tests__/` - Hash function tests
- `src/schemas/input/__tests__/` - Input validation tests

Run tests with:

```bash
pnpm masumi:test
```

## Best Practices

### ✅ Do

- Use the `Result` type for fallible operations
- Validate all external responses with Zod schemas
- Use the agent client factory for all agent API calls
- Hash inputs/results with the provided hash functions

### ❌ Don't

- Throw errors from client methods (use `Result` instead)
- Access agent APIs directly without validation
- Modify hash algorithms without updating verification
- Use deprecated `hashInputDeprecated` function

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Masumi Protocol Documentation](https://www.masumi.network/dev/masumi/)
- [Zod Documentation](https://zod.dev/)
