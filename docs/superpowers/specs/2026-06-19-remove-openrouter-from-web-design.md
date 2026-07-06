# Remove OpenRouter from the web app — migrate name generation to core

- **Date**: 2026-06-19
- **Status**: Approved (design)
- **Scope**: `apps/web`, `apps/core`, `packages/utils`

## Goal

Remove OpenRouter entirely from `apps/web`. Move job and task name
generation into `apps/core`, which already owns the OpenRouter client and job
naming. Web becomes a pure pass-through: it sends the task description / job
input and core derives the name. This removes the LLM secret and the
`@openrouter/ai-sdk-provider` dependency from the web runtime and eliminates
duplicated naming logic.

This follows the repo architecture rule: web is a thin client; core owns all
data access and LLM secrets; shared pure helpers live in `@sokosumi/utils`.

## Background / current state

- **Job naming** is already duplicated. Core `helpers/job.ts` has
  `resolveJobName` (generate when `name` absent). Web `actions/job/action.ts`
  pre-generates the name via `openrouterClient.generateJobName` and passes it
  to core's `startJob`, so core's generator is only a fallback today. Web's
  pre-generation is redundant.
- **Task naming** has no core equivalent. Web `actions/task/action.ts`
  (`createTaskFromDescription`) is the only place a task gets named: it strips
  the `DESIGN.md` attachment link, calls `openrouterClient.generateTaskName`,
  falls back to the first non-empty line, then clamps to 120 chars.
- The web OpenRouter client (`src/lib/clients/openrouter.client.ts`) is used
  **only** for these two name generators. Its raw `openrouter` provider export
  is unused. `@openrouter/ai-sdk-provider` is imported in web at exactly this
  one file.
- Core `clients/openrouter.client.ts` has `generateJobName`, `generateTaskName`,
  `generateChatTitle`, and `generateAgentSummary`. Chat streaming uses
  `@sokosumi/ai-provider` (not this client). It is null-safe (returns `null`
  when the key is unset).
- There is **one** task-create route: `apps/core/src/routes/v1/tasks/post.ts`.
  `projects/[id]/tasks/post.ts` only *assigns* an existing task to a project.
- `removeDesignMdAttachmentLinks` (web `lib/utils/task-attachments.ts`) is a
  pure transform depending only on `@sokosumi/utils` (`replaceMarkdownLinks`)
  plus a `"DESIGN.md"` label constant. It is also used by web chat input
  (`components/chat/multimodal-input.tsx`) for live editing.
- `clampTaskNameForCoreApi` (web `lib/utils/task-transformer.ts`) is used both
  for the generated name (create path) and for the user-typed name in the
  `updateTask` rename path.

## Design decision

Design-md link stripping moves into core. `removeDesignMdAttachmentLinks` (and
its `DESIGN.md` label constant) move to `@sokosumi/utils`; core strips then
names; web keeps using it for live chat-input editing by importing from utils.
One implementation, two consumers, naming fully owned by core. (Rejected
alternatives: send a separate "naming hint" field from web — re-splits naming
across the boundary; or skip stripping — regresses name quality when a
`DESIGN.md` link is present.)

## Changes

### `packages/utils`

1. Add a module (e.g. `design-md-attachment.ts`) exporting
   `removeDesignMdAttachmentLinks` and `DESIGN_MD_ATTACHMENT_LABEL`. Export
   both from `src/index.ts`. Move the existing unit test into the package.

### `apps/core`

2. `src/clients/openrouter.client.ts`: add
   `generateTaskName(description: string): Promise<string | null>` — the same
   prompt web uses (concise 30–60 char task name, match input language, single
   sentence, no trailing punctuation), null-safe like the sibling methods
   (returns `null` if `defaultOpenrouter` is unset or on error).
3. `src/helpers/task.ts`: add `resolveTaskName({ name, description })`:
   - If `name` is provided and non-empty → return its trimmed value.
   - Else: strip design-md links from `description`
     (`removeDesignMdAttachmentLinks`), call `generateTaskName`, fall back to
     the first non-empty line (≤ 60 chars), then `"Untitled Task"`; clamp the
     result to 120 chars.
   - Pure/await helper, independently unit-testable; keeps the route thin.
4. `src/routes/v1/tasks/post.ts`:
   - `createTaskRequestSchema.name` → optional
     (`z.string().min(1).max(120).optional()`).
   - Call `resolveTaskName({ name: body.name, description: body.description })`
     **before** `prisma.$transaction`, and use the resolved name in
     `tx.task.create`. No LLM call is made inside the DB transaction.
   - `superRefine` (coworker-required-for-non-draft) unchanged.
5. Core OpenRouter env (`OPENROUTER_DEFAULT_API_KEY`) is already declared — no
   change.

### `apps/web`

6. `src/lib/actions/job/action.ts`: delete `generateCoreJobNameForJobStart`;
   stop passing the generated `name` to core `startJob` (core `resolveJobName`
   already generates when absent); remove the `openrouterClient` import.
7. `src/lib/actions/task/action.ts`: in `createTaskFromDescription`, remove
   name generation, design-md stripping for naming, `buildFallbackName`, and
   the generated-name clamp. Keep the design-md *append*
   (`appendDesignMdToDescription`) unchanged and call `taskService.createTask`
   **without** `name`. Remove `buildFallbackName` (logic now in core) and the
   now-unused imports (`openrouterClient`, `removeDesignMdAttachmentLinks`).
   The `updateTask` rename path is unchanged and keeps `clampTaskNameForCoreApi`.
8. `src/lib/services/task.service.ts`: `CreateTaskInput.name` → optional.
9. Delete `src/lib/clients/openrouter.client.ts`; remove its re-export from
   `src/lib/clients/index.ts`.
10. `src/config/env.secrets.ts`: remove `OPENROUTER_DEFAULT_API_KEY`.
11. `apps/web/package.json`: remove `@openrouter/ai-sdk-provider`. Keep `ai`
    (used by chat UI in ~15 files).
12. `apps/web/.env`: remove `OPENROUTER_DEFAULT_API_KEY`
    (`OPENROUTER_CHAT_API_KEY` already removed earlier).
13. Repoint web importers of `removeDesignMdAttachmentLinks`
    (`components/chat/multimodal-input.tsx`) to `@sokosumi/utils`; remove the
    definition (and the `DESIGN.md` label constant) from web
    `lib/utils/task-attachments.ts`.

### Core API client regeneration

14. After the schema change run `pnpm --filter web generate:core:snapshot`.
    Commit the regenerated client as-is (no hand edits).

## Data flow after the change

**Task create**: `createTask(description)` → append design-md →
`taskService.createTask({ description, … })` → `POST /v1/tasks` (no `name`) →
core `resolveTaskName` (strip design-md → `generateTaskName` → fallback/clamp)
→ `task.create`. Rename still flows `updateTask` → `patchTask` with the user's
name (clamped in web).

**Job start**: web `startJob` → core `startJob` → existing `resolveJobName`
generates when `name` is absent. Web no longer pre-generates.

## Error handling

- `generateTaskName` is null-safe: on LLM error or missing key it returns
  `null`; core falls back to the first non-empty line, then `"Untitled Task"`.
  Task creation is never blocked by naming.
- The LLM call runs **before** the DB transaction, so a slow or failing LLM
  never holds a transaction open — mirroring the job path, which names only
  after the balance preflight (`helpers/job.ts`), so rejected starts incur no
  LLM cost.
- No new failure surface is added in web (it stops making the call entirely).

## Testing

- **Core**
  - `generateTaskName` unit test (mock `generateText`): returns trimmed text;
    returns `null` on error / missing key.
  - `resolveTaskName` unit tests: provided name passes through; generated when
    absent; design-md link stripped before naming; fallback to first line;
    fallback to `"Untitled Task"`; clamp to 120.
  - `tasks/post` route test: `name` omitted → generated name persisted; `name`
    provided → used verbatim.
- **`packages/utils`**: moved `removeDesignMdAttachmentLinks` test.
- **Web**
  - `actions/task/action` tests: remove the openrouter mock; assert
    `taskService.createTask` is called without `name`.
  - `actions/job/action` tests: remove the openrouter mock; assert core
    `startJob` is called without a pre-generated `name`.
- **Gates**: `pnpm core:test`, `pnpm web:test`, `pnpm check`,
  `pnpm web:build`, `pnpm core:build`.

## Out of scope (YAGNI)

- Not consolidating core's four `generate*` methods into a single
  `generateName` — separate cleanup; keep this diff focused.
- Not relocating the `updateTask` clamp; `clampTaskNameForCoreApi` stays in web
  for the user-typed rename path.
- Chat-title and agent-summary generation already live in core — untouched.

## Verification checklist

- [ ] `@openrouter/ai-sdk-provider` no longer appears in `apps/web` (grep).
- [ ] `OPENROUTER_DEFAULT_API_KEY` removed from web `.env` and
      `env.secrets.ts`.
- [ ] Generated core client reflects optional `name`; not hand-edited.
- [ ] All gates green.
