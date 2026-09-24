# Sokosumi agent contract

Sokosumi is a pnpm monorepo: Next.js Web, Hono Core, native Apple apps, and shared packages. Use Node.js 24 and the pnpm version in `package.json`.

## Load context for the task

Before working in an app or package, read its `AGENTS.md` and any deeper instructions on the target path. Scoped instructions supplement this contract. Before starting each activity below, read its required document; these are instructions, not optional background. Reuse documents already read. Load additional context when the task expands, rather than reading every reference at session start.

| Activity | Required context |
| --- | --- |
| Implementing, refactoring, or reviewing code; changing architecture or the build graph | [Architecture and implementation rules](docs/agents/architecture.md) |
| Writing or reviewing TypeScript, tests, dependencies, or lint configuration | [Code conventions and testing](docs/agents/coding-conventions.md) |
| Implementing or reviewing Web UI, styling, or React components | [Web UI conventions](docs/agents/web-ui.md), `apps/web/AGENTS.md`, and its required UI skills |
| Installing dependencies, configuring env/DB, launching services, or performing browser verification/login | [Local development](docs/agents/local-development.md); use `.cursor/skills/verify-sokosumi/` for launch, doctor, and sign-in |
| Running in Cursor Cloud or a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`); provisioning, using, or tearing down a cloud-agent DB | [Cloud environment](docs/agents/cloud-environment.md) and [cloud database runbook](docs/agents/cloud-agent-database.md), before running commands |
| Creating branches, committing, pushing, opening/updating PRs, or modifying CI checks | [Delivery rules](docs/agents/delivery.md) |
| Choosing an engineering flow; maintaining skills; working on Next.js, evlog, SwiftUI, Linear, translations, domain docs, coworker access, or Soko Bot | The matching section of [Skill and domain routing](docs/agents/skill-routing.md), then its referenced skill/docs |

Existing scope entry points: [Web](apps/web/AGENTS.md), [Core](apps/core/AGENTS.md), [Apple](apps/apple/AGENTS.md), [CLI](apps/cli/AGENTS.md), [Database](packages/database/AGENTS.md), [Masumi](packages/masumi/AGENTS.md), [Email](packages/email/AGENTS.md). Packages without a scoped AGENTS.md (`ai-provider`, `net`, `soko-bot`, `utils`) use this contract. Check for deeper instructions even when the directory is not listed here.

## Always apply

- **Keep data ownership in Core.** Web uses the generated Core API client through services/actions; it never imports `@sokosumi/database`, calls Prisma, or queries Postgres. New Core data access uses versioned routes, direct Prisma, and validated OpenAPI schemas. Web domain enum values come from the generated client, not `@sokosumi/utils`.
- **Fix sources, then regenerate.** Never hand-edit generated artifacts. After a Core endpoint change, run `pnpm --filter web generate:core:snapshot`, then Web typecheck separately. See the architecture rules for DTO and shared-package boundaries.
- **Reuse before adding.** Search existing implementations and state which candidates fit before creating a helper, module, wrapper, or alternate path. Extend the existing seam; share duplicated logic. Ship the smallest complete slice. Remove obsolete callers and misleading names; preserve required migrations and API versioning.
- **Verify changes.** Run the appropriate checks and review the diff. Fix findings and repeat until no issues remain. Prefer root Turbo commands (`pnpm typecheck`, `pnpm test`, `pnpm build`); generate Prisma first when bypassing Turbo with a filtered command. `pnpm check` covers Biome. Run relevant tests before pushing. Let commit hooks run; repair missing dependencies instead of bypassing hooks.
- **Deliver predictably.** Conventional Commit subjects; PR title equals the primary commit subject. PRs start as drafts unless explicitly requested otherwise. Linear branches start with the lowercase issue identifier; do not invent or file issues during implementation. Humans merge Linear implementation PRs.

## Session behavior

- Provide clear progress updates during long tasks. Use a todo list for complex work and mark items complete as they finish.
- When present, load [Caveman](.agents/skills/caveman/SKILL.md) for replies. Load [Ponytail](.agents/skills/ponytail/SKILL.md) for coding work (default full). Their documented off switches remain supported.
- For engineering flow selection, use [Ask Matt](.agents/skills/ask-matt/SKILL.md). For app work, resolve named skills in `apps/<app>/.agents/skills/<name>/` first, then `.agents/skills/<name>/`, then `skills/<name>/`. Load only skills whose triggers apply.
- Before changing this instruction layout, read [writing-for-agents](.agents/skills/writing-for-agents/SKILL.md). Keep universal guardrails here; put task-specific detail behind explicit loading triggers. Preserve requirements and repair incoming links when moving sections.
