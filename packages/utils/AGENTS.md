# Utils Package Agent Guidelines

> **Purpose**: Package-specific guidelines for `@sokosumi/utils`. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/utils`
**Purpose**: Framework-agnostic shared helpers and client-safe types (URLs, files, markdown, credits, locale, auth cookies/session shapes, Ably channel names, task-status logic)
**Runtime**: Node.js 24.x
**Location**: `packages/utils/` within the pnpm workspace

## Layout

The live tree is `src/`. One main export in `package.json` (`@sokosumi/utils`). `prepare` compiles `src/` to `dist/`.

## Entry Points

Import from the package root. Export new symbols from `src/index.ts`.

```typescript
import {
  convertCentsToCredits,
  convertCreditsToCents,
  isHttpUrl,
} from "@sokosumi/utils";
```

Used by Core, Web, `@sokosumi/database`, and `@sokosumi/ai-provider`.

## Key Conventions

- Pure TypeScript only: no Prisma, no React, no Hono, no `server-only`, no app env.
- Shared product vocabulary that both UI and server need (credit conversion, billing plan name parsers, Better Auth session types) lives here. Prisma-backed resolution stays in `@sokosumi/database/helpers`.
- Web entity DTOs and domain enum **runtime maps** come from the generated Core client, not this package. Approved Web imports and the DTO boundary live in [apps/web/AGENTS.md](../../apps/web/AGENTS.md).
- Import this package at the call site. Do not re-export its symbols from database helpers or app passthrough modules.

## Package-Specific Commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @sokosumi/utils build` | Compile `src/` to `dist/` |
| `pnpm --filter @sokosumi/utils test` | Run Vitest |
| `pnpm --filter @sokosumi/utils typecheck` | Typecheck |
| `pnpm --filter @sokosumi/utils lint` | Lint |

After adding or changing exports, build this package so consumers that resolve `dist/` pick up the new surface.

## Testing

Place `foo.test.ts` next to `foo.ts`. Use `src/__tests__/` only for tests that do not map 1:1 to a source file.

## Best Practices

### Do

- Add a new shared helper here when more than one app or package would use the same pure logic
- Export it from `src/index.ts` and import `@sokosumi/utils` directly at each call site
- Keep credit conversion here; keep credit-bucket / billing-plan **resolution** in `@sokosumi/database/helpers`

### Don't

- Import `@sokosumi/database` from this package or from Web
- Add Prisma-shaped entity mirrors or Core OpenAPI enum maps for Web to consume
- Put request/cookie/header parsing or I/O here

## Additional Rules

- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc)
- [Shared packages](../../.cursor/rules/shared-packages.mdc)
- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc)

## References

- [Root AGENTS.md](../../AGENTS.md)
- [Architecture and implementation rules](../../docs/agents/architecture.md)
