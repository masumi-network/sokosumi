# AI Provider Package Agent Guidelines

> **Purpose**: Package-specific guidelines for `@sokosumi/ai-provider`. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/ai-provider`
**Purpose**: Vercel AI SDK `LanguageModelV4` provider for Sokosumi chat (`createSokosumi`). Talks to OpenRouter Responses API or a coworker agent HTTP surface.
**Runtime**: Node.js 24.x
**Location**: `packages/ai-provider/` within the pnpm workspace

## Layout

The live tree is `src/`. One main export in `package.json`. `prepare` compiles `src/` to `dist/`.

- `create-sokosumi.ts` — `createSokosumi({ openRouterApiKey, … })` factory
- `sokosumi-language-model.ts` — model implementation
- `prompt/` — map AI SDK prompts onto OpenRouter Responses input
- `stream/` — SSE → v4 stream, conversation commit gate
- `coworker-agent-error.ts` — detect coworker agent error text in a stream

## Entry Points

Core owns the singleton. Do not construct a second provider in routes.

```typescript
import { createSokosumi } from "@sokosumi/ai-provider";
import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";

const provider = createSokosumi({
  openRouterApiKey,
  openRouterHttpReferer,
  openRouterAppTitle: "Sokosumi",
});
```

Call-site wiring:

- Factory: `apps/core/src/lib/sokosumi-ai-provider.ts` (`getSokosumiProvider()`)
- Stream options: `apps/core/src/routes/v1/chats/rooms/[id]/stream/post.ts`
- Coworker dispatch: `apps/core/src/services/chat-room-coworker-dispatch.service.ts`

Web does not depend on this package.

## Key Conventions

- Provider modes are `"openrouter"` | `"coworker"`, passed per call as `SokosumiProviderCallOptions`.
- `createSokosumi` takes OpenRouter credentials. Coworker base URL, slug, and user/org ids are call options, not factory options.
- Extend the existing language-model / stream mapping. Do not add a parallel provider next to this one.

## Package-Specific Commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @sokosumi/ai-provider build` | Compile `src/` to `dist/` |
| `pnpm --filter @sokosumi/ai-provider test` | Run Vitest |
| `pnpm --filter @sokosumi/ai-provider typecheck` | Typecheck |
| `pnpm --filter @sokosumi/ai-provider lint` | Lint |

## Testing

Place `foo.test.ts` next to `foo.ts`. Use a `foo.<case>.test.ts` suffix when one source file has several focused suites.

## Best Practices

### Do

- Use `getSokosumiProvider()` from Core for production calls
- Keep OpenRouter vs coworker behavior in this package; Core supplies env and call options

### Don't

- Import this package from Web
- Bypass the Core singleton to `createSokosumi` in a route or service

## References

- [Root AGENTS.md](../../AGENTS.md)
- [AI SDK skill](.agents/skills/ai-sdk/SKILL.md) (load when changing provider/stream mapping)
