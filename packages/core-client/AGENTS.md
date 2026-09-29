# Core Client Package Agent Guidelines

> **Purpose**: Package-specific guidelines for `@sokosumi/core-client`. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/core-client`
**Purpose**: The generated TypeScript client for Core's `/v1` API, shared by every app that calls Core
**Location**: `packages/core-client/` within the pnpm workspace

## Layout

`src/generated/` is entirely `@hey-api/openapi-ts` output from `openapi-ts.config.ts`. Consumers read the compiled `dist/`: `prepare`, Turbo's `^build`, and both generate scripts rebuild it. Never hand-edit `src/generated/`; change Core's Zod/OpenAPI schemas and regenerate.

## Entry Points

```typescript
import { getTasks, TaskStatus, type Task } from "@sokosumi/core-client";
import { createClient, type Client } from "@sokosumi/core-client/client";
import { getHistoryResponseTransformer } from "@sokosumi/core-client/transformers";
import { NotificationPreferenceSchema } from "@sokosumi/core-client/schemas";
```

## Regenerating

| Command | Purpose |
| --- | --- |
| `pnpm --filter @sokosumi/core-client generate:snapshot` | Writes Core's OpenAPI snapshot (no running server) and regenerates `src/generated` |
| `pnpm --filter @sokosumi/core-client generate` | Regenerates from a running Core at `http://localhost:8787/v1/openapi.json` |

After regenerating, run `pnpm typecheck` to catch DTO drift in consumers. Do not chain typecheck into the generate script. Commit the regenerated files as-is.
