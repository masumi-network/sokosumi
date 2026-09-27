# Soko Bot Package Agent Guidelines

> **Purpose**: Package-specific guidelines for `@sokosumi/soko-bot`. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/soko-bot`
**Purpose**: Shared Soko Bot **contracts** — capabilities, persona, memory, tool schemas, versions, wire types, and the `SokoBotRuntime` port. Not a runtime and not a deployable.
**Runtime**: Node.js 24.x
**Location**: `packages/soko-bot/` within the pnpm workspace

## Layout

The live tree is `src/`. One main export in `package.json`. `prepare` compiles `src/` to `dist/`.

| Module | Role |
| --- | --- |
| `policy.ts` | Routes, capabilities, hire-budget checks |
| `tool-contracts.ts` | Per-capability Zod input schemas and descriptions |
| `runtime.ts` | `SokoBotRuntime` port and turn/event types |
| `wire-contracts.ts` | `sokoBotContextPacketSchema` |
| `versions/` | Version ids, skills, system-prompt composition |
| `memory.ts`, `persona.ts`, `proactive.ts`, `judge.ts`, `scenarios.ts`, `integrations.ts` | Shared policy and admin-lab contracts |

The in-process loop lives in Core (`apps/core/src/lib/soko-bot/`). There is no `apps/soko-bot`.

## Entry Points

```typescript
import {
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotRuntime,
  sokoBotContextPacketSchema,
} from "@sokosumi/soko-bot";
```

Core implements the port (`in-process-runtime.ts`, `in-memory-runtime.ts`) and owns data, classification, context packets, schedules, memory writes, and Task/Job mutations. Web imports this package for admin scenario-lab and product copy that must stay aligned with capabilities — not to run the bot.

## Key Conventions

- Change a capability in this package together with its tool schema, description, and Core handler. The package test locks schema/description keys to `SOKO_BOT_CAPABILITIES`.
- Keep Prisma, HTTP, and the agent loop in Core. This package stays Zod/types/constants.
- `SokoBotRuntime` is the seam. Swap adapters in Core; do not add a second contract package.

## Package-Specific Commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @sokosumi/soko-bot build` | Compile `src/` to `dist/` |
| `pnpm --filter @sokosumi/soko-bot test` | Run Vitest |
| `pnpm --filter @sokosumi/soko-bot typecheck` | Typecheck |
| `pnpm --filter @sokosumi/soko-bot lint` | Lint |

## Testing

Cross-module contract tests live in `src/__tests__/`.

## Best Practices

### Do

- Treat this package as the shared contract Core and Web both import
- Implement turns, tools, and persistence under `apps/core/src/lib/soko-bot/` and Core services

### Don't

- Recreate `apps/soko-bot` or a separate Eve/Vercel deployable
- Put database access or HTTP handlers in this package

## References

- [Root AGENTS.md](../../AGENTS.md)
- [Core AGENTS.md](../../apps/core/AGENTS.md) (`lib/soko-bot/`)
- [ADR 0007](../../docs/adr/0007-soko-bot-eve-runtime.md) — loop runs in-process in Core
- [Skill routing](../../docs/agents/skill-routing.md) (Soko Bot)
