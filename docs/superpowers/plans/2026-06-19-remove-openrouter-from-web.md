# Remove OpenRouter from Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the OpenRouter client, secret, and dependency from `apps/web` by moving job + task name generation into `apps/core`.

**Architecture:** Core already owns the OpenRouter client and job naming (`resolveJobName`). We add task naming to core, make the task-create `name` optional (core generates it when absent), relocate the pure `removeDesignMdAttachmentLinks` helper to `@sokosumi/utils`, then strip all OpenRouter usage from web. Web becomes a pure pass-through that sends a description and lets core name the task/job.

**Tech Stack:** Next.js (web), Hono + `@hono/zod-openapi` (core), `@sokosumi/database` (Prisma), `@sokosumi/utils` (shared pure helpers), Vitest, Biome, pnpm workspace, `@hey-api/openapi-ts` (generated core client).

## Global Constraints

- Pin exact dependency versions; never edit generated files by hand (regenerate them).
- Web must not import `@sokosumi/database`, Prisma, or raw SQL; data access is via the generated core client only.
- Biome: 2-space indent, double quotes, semicolons, trailing commas; run `pnpm format` / `pnpm check` after edits. Prefix intentionally-unused vars with `_`.
- `@sokosumi/utils` `dist/` is gitignored; after editing its `src`, rebuild with `pnpm --filter @sokosumi/utils build` before web/core tests or builds resolve the new export.
- Task name max length = 120 (matches core schema `max(120)`); task fallback name max length = 60.
- Conventional Commit messages. Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Work happens on branch `worktree-remove-openrouter-from-web` (already checked out).

---

### Task 1: Relocate `removeDesignMdAttachmentLinks` to `@sokosumi/utils`

Move the pure design-md strip helper (and its label constant) into the shared
package so core can use it for naming; repoint web importers.

**Files:**
- Create: `packages/utils/src/design-md-attachment.ts`
- Create: `packages/utils/src/__tests__/design-md-attachment.test.ts`
- Modify: `packages/utils/src/index.ts` (add export)
- Modify: `apps/web/src/lib/utils/task-attachments.ts` (remove the moved function + constant)
- Modify: `apps/web/src/lib/utils/__tests__/task-attachments.test.ts` (remove the two moved test cases + the import)
- Modify: `apps/web/src/components/chat/multimodal-input.tsx` (import from `@sokosumi/utils`)
- Modify: `apps/web/src/lib/actions/task/action.ts` (import from `@sokosumi/utils` — temporary; usage removed in Task 4)

**Interfaces:**
- Produces: `removeDesignMdAttachmentLinks(markdown: string): string` and `DESIGN_MD_ATTACHMENT_LABEL: "DESIGN.md"` from `@sokosumi/utils`.

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/__tests__/design-md-attachment.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  DESIGN_MD_ATTACHMENT_LABEL,
  removeDesignMdAttachmentLinks,
} from "../design-md-attachment.js";

describe("removeDesignMdAttachmentLinks", () => {
  it("exposes the DESIGN.md label", () => {
    expect(DESIGN_MD_ATTACHMENT_LABEL).toBe("DESIGN.md");
  });

  it("removes DESIGN.md attachment links from task descriptions", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design.md)",
      "",
      "Build landing page",
    ].join("\n");

    expect(removeDesignMdAttachmentLinks(markdown)).toBe("Build landing page");
  });

  it("removes DESIGN.md links when the url contains parens", () => {
    const markdown = [
      "[DESIGN.md](https://blob.example/design%29.md)",
      "",
      "Build landing page",
    ].join("\n");

    expect(removeDesignMdAttachmentLinks(markdown)).toBe("Build landing page");
  });

  it("leaves non-DESIGN.md links untouched", () => {
    const markdown = "[notes.pdf](https://blob.example/notes.pdf)\n\nBody";
    expect(removeDesignMdAttachmentLinks(markdown)).toBe(markdown);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sokosumi/utils test design-md-attachment`
Expected: FAIL — cannot resolve `../design-md-attachment.js`.

- [ ] **Step 3: Create the helper**

Create `packages/utils/src/design-md-attachment.ts`:

```typescript
import { replaceMarkdownLinks } from "./markdown-links.js";

export const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

export function removeDesignMdAttachmentLinks(markdown: string): string {
  const withoutLinks = replaceMarkdownLinks(markdown, (match) =>
    match.text === DESIGN_MD_ATTACHMENT_LABEL ? "" : match.match,
  );

  return withoutLinks.replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Export from the package index**

In `packages/utils/src/index.ts`, add (keep the file's alphabetical-by-module grouping):

```typescript
export {
  DESIGN_MD_ATTACHMENT_LABEL,
  removeDesignMdAttachmentLinks,
} from "./design-md-attachment.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sokosumi/utils test design-md-attachment`
Expected: PASS (4 tests).

- [ ] **Step 6: Build utils so consumers resolve the new export**

Run: `pnpm --filter @sokosumi/utils build`
Expected: tsc completes, no errors.

- [ ] **Step 7: Remove the function + constant from web `task-attachments.ts`**

In `apps/web/src/lib/utils/task-attachments.ts`, delete the
`DESIGN_MD_ATTACHMENT_LABEL` constant and the `removeDesignMdAttachmentLinks`
function (the block currently at lines ~130–139). Leave the rest of the file
(`extractTaskAttachmentUrls`, `formatTaskAttachmentMarkdown`,
`removeTaskAttachmentLinks`, etc.) unchanged.

- [ ] **Step 8: Update web `task-attachments.test.ts`**

In `apps/web/src/lib/utils/__tests__/task-attachments.test.ts`:
- Remove `removeDesignMdAttachmentLinks` from the import list (line ~10).
- Delete the two `it(...)` blocks that call it:
  `"removes DESIGN.md attachment links from task descriptions"` and
  `"removes DESIGN.md links when the url contains escaped closing parens"`
  (lines ~119–138). These behaviors are now covered in the utils package test.

- [ ] **Step 9: Repoint web importers to `@sokosumi/utils`**

In `apps/web/src/components/chat/multimodal-input.tsx`, remove
`removeDesignMdAttachmentLinks` from the `@/lib/utils/task-attachments` import
and add it to the existing `@sokosumi/utils` import (or a new one):

```typescript
import { removeDesignMdAttachmentLinks } from "@sokosumi/utils";
```

In `apps/web/src/lib/actions/task/action.ts`, change line 16 from:

```typescript
import { removeDesignMdAttachmentLinks } from "@/lib/utils/task-attachments";
```

to:

```typescript
import { removeDesignMdAttachmentLinks } from "@sokosumi/utils";
```

(This import is removed entirely in Task 4; repointing now keeps the build green.)

- [ ] **Step 10: Lint + run affected web tests**

Run: `pnpm web:check`
Expected: no errors (no unused imports, formatting clean).

Run: `pnpm --filter web test task-attachments`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/utils/src/design-md-attachment.ts \
  packages/utils/src/__tests__/design-md-attachment.test.ts \
  packages/utils/src/index.ts \
  apps/web/src/lib/utils/task-attachments.ts \
  apps/web/src/lib/utils/__tests__/task-attachments.test.ts \
  apps/web/src/components/chat/multimodal-input.tsx \
  apps/web/src/lib/actions/task/action.ts
git commit -m "refactor(utils): move removeDesignMdAttachmentLinks to @sokosumi/utils

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Add task naming to core (`generateTaskName` + `resolveTaskName`)

Add the LLM task-name wrapper to core's OpenRouter client and a small,
isolated `resolveTaskName` helper that encapsulates the strip → generate →
fallback → clamp logic. No route wiring yet.

**Files:**
- Modify: `apps/core/src/clients/openrouter.client.ts` (add `generateTaskName`)
- Create: `apps/core/src/helpers/task-name.ts`
- Create: `apps/core/src/helpers/task-name.test.ts`

**Interfaces:**
- Consumes: `removeDesignMdAttachmentLinks` from `@sokosumi/utils` (Task 1).
- Produces:
  - `openrouterClient.generateTaskName(description: string): Promise<string | null>`
  - `resolveTaskName(input: { name?: string | null; description?: string | null }): Promise<string>`

- [ ] **Step 1: Add `generateTaskName` to the core OpenRouter client**

In `apps/core/src/clients/openrouter.client.ts`, inside the returned object
(after `generateJobName`), add:

```typescript
    async generateTaskName(description: string): Promise<string | null> {
      if (!defaultOpenrouter) {
        return null;
      }

      const systemPrompt = `Generate a concise task name following these rules:
        - Length: 30-60 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single sentence
        - Output: Name only, no other text
        - Do NOT: include end of sentence punctuation
      `;
      const userPrompt = `Task Description: ${description}`;

      try {
        const { text } = await generateText({
          model: defaultOpenrouter("anthropic/claude-haiku-4.5"),
          system: systemPrompt,
          prompt: userPrompt,
          temperature: 0.9,
          maxOutputTokens: 40,
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter task name generation failed:", error);
        return null;
      }
    },
```

- [ ] **Step 2: Write the failing test for `resolveTaskName`**

Create `apps/core/src/helpers/task-name.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTaskNameMock = vi.fn();

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));

import { resolveTaskName } from "./task-name";

describe("resolveTaskName", () => {
  beforeEach(() => {
    generateTaskNameMock.mockReset();
  });

  it("uses a provided name verbatim (trimmed) and skips the LLM", async () => {
    expect(await resolveTaskName({ name: "  Hello  ", description: "x" })).toBe(
      "Hello",
    );
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("clamps a provided name to 120 characters", async () => {
    const long = "A".repeat(200);
    expect(await resolveTaskName({ name: long, description: null })).toBe(
      "A".repeat(120),
    );
  });

  it("generates from the description when no name is provided", async () => {
    generateTaskNameMock.mockResolvedValue("Generated name");
    expect(await resolveTaskName({ description: "Build landing page" })).toBe(
      "Generated name",
    );
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
  });

  it("strips DESIGN.md links before naming", async () => {
    generateTaskNameMock.mockResolvedValue("Generated name");
    await resolveTaskName({
      description:
        "[DESIGN.md](https://blob.example/design.md)\n\nBuild landing page",
    });
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
  });

  it("falls back to the first non-empty line when generation returns null", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(await resolveTaskName({ description: "First line\nsecond" })).toBe(
      "First line",
    );
  });

  it("returns 'Untitled Task' when there is no naming source", async () => {
    expect(await resolveTaskName({ description: "   " })).toBe("Untitled Task");
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("clamps a generated name to 120 characters", async () => {
    generateTaskNameMock.mockResolvedValue("B".repeat(200));
    expect(await resolveTaskName({ description: "x" })).toBe("B".repeat(120));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @sokosumi/core test task-name`
Expected: FAIL — cannot resolve `./task-name`.

- [ ] **Step 4: Implement `resolveTaskName`**

Create `apps/core/src/helpers/task-name.ts`:

```typescript
import { removeDesignMdAttachmentLinks } from "@sokosumi/utils";

import { openrouterClient } from "@/clients/openrouter.client";

const TASK_NAME_MAX_LENGTH = 120;
const TASK_FALLBACK_NAME_MAX_LENGTH = 60;
const UNTITLED_TASK_NAME = "Untitled Task";

function fallbackTaskName(source: string): string {
  const firstLine = source.split("\n").find((line) => line.trim());
  return (firstLine ?? "").trim().slice(0, TASK_FALLBACK_NAME_MAX_LENGTH);
}

export async function resolveTaskName(input: {
  name?: string | null;
  description?: string | null;
}): Promise<string> {
  const provided = input.name?.trim();
  if (provided) {
    return provided.slice(0, TASK_NAME_MAX_LENGTH);
  }

  const namingSource = removeDesignMdAttachmentLinks(
    input.description ?? "",
  ).trim();
  if (!namingSource) {
    return UNTITLED_TASK_NAME;
  }

  const generated = (await openrouterClient.generateTaskName(namingSource))?.trim();
  const candidate = generated || fallbackTaskName(namingSource);
  return candidate.slice(0, TASK_NAME_MAX_LENGTH) || UNTITLED_TASK_NAME;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sokosumi/core test task-name`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck + lint core**

Run: `pnpm --filter @sokosumi/core typecheck && pnpm --filter @sokosumi/core check`
Expected: no errors. (`TASK_FALLBACK_NAME_MAX_LENGTH` is used; no unused symbols.)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/clients/openrouter.client.ts \
  apps/core/src/helpers/task-name.ts \
  apps/core/src/helpers/task-name.test.ts
git commit -m "feat(core): add task name generation helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire core task-create to generate the name, regenerate the client

Make `name` optional in the create-task schema, resolve the name before the DB
transaction, and regenerate the web core client so web sees the optional field.

**Files:**
- Modify: `apps/core/src/routes/v1/tasks/post.ts`
- Modify: `apps/core/src/routes/v1/tasks/post.test.ts`
- Regenerate: `apps/web/src/lib/clients/generated/core/*` + `apps/web/openapi-core.snapshot.json` (via command — do NOT hand-edit)

**Interfaces:**
- Consumes: `resolveTaskName` from `@/helpers/task-name` (Task 2).
- Produces: `POST /v1/tasks` accepts an optional `name`; when omitted, core derives it from `description`.

- [ ] **Step 1: Make `name` optional in the request schema**

In `apps/core/src/routes/v1/tasks/post.ts`, change the `name` field of
`createTaskRequestSchema` from:

```typescript
    name: z.string().min(1).max(120).openapi({ example: "Review onboarding" }),
```

to:

```typescript
    name: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .openapi({ example: "Review onboarding" }),
```

- [ ] **Step 2: Resolve the name before the transaction**

In the same file, add the import:

```typescript
import { resolveTaskName } from "@/helpers/task-name";
```

In the handler, immediately after `const body = c.req.valid("json");` and
before `const task = await prisma.$transaction(...)`, add:

```typescript
    const resolvedName = await resolveTaskName({
      name: body.name,
      description: body.description,
    });
```

Then in the `tx.task.create` data object, change `name: body.name,` to:

```typescript
          name: resolvedName,
```

- [ ] **Step 3: Update + extend the route test**

In `apps/core/src/routes/v1/tasks/post.test.ts`:

Add the openrouter mock near the other `vi.mock` calls (after the
`vi.hoisted` block — add `generateTaskNameMock` to the hoisted object):

```typescript
vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));
```

Add `generateTaskNameMock: vi.fn()` to the `vi.hoisted({...})` object and to
its destructured names. In the `POST /tasks` `beforeEach`, add:

```typescript
    generateTaskNameMock.mockResolvedValue("Generated name");
```

Add two tests inside `describe("POST /tasks", ...)`:

```typescript
  it("generates a name from the description when name is omitted", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Build landing page",
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Generated name" }),
      }),
    );
  });

  it("uses a provided name verbatim without generating", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My task",
        description: "Build landing page",
        coworkerId: null,
        status: TaskStatus.DRAFT,
        origin: TaskEventOrigin.SOKOSUMI,
      }),
    });

    expect(response.status).toBe(201);
    expect(generateTaskNameMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "My task" }),
      }),
    );
  });
```

- [ ] **Step 4: Run the route + schema tests to verify they pass**

Run: `pnpm --filter @sokosumi/core test tasks/post`
Expected: PASS — existing tests still green; two new tests pass.

- [ ] **Step 5: Regenerate the web core client**

Run: `pnpm --filter web generate:core:snapshot`
Expected: regenerates `apps/web/openapi-core.snapshot.json` and
`apps/web/src/lib/clients/generated/core/*`. In the diff, the create-task
request type's `name` becomes optional. Do not hand-edit any generated file.

- [ ] **Step 6: Typecheck web (generated client still consumed with a name today)**

Run: `pnpm --filter web typecheck`
Expected: no errors (web still passes `name`, which remains valid).

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/routes/v1/tasks/post.ts \
  apps/core/src/routes/v1/tasks/post.test.ts \
  apps/web/openapi-core.snapshot.json \
  apps/web/src/lib/clients/generated/core
git commit -m "feat(core): generate task name when omitted on create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Stop generating task names in web

Web sends the description and lets core name the task. Remove the web-side
naming, the now-unused helper/import, and make the service input `name`
optional.

**Files:**
- Modify: `apps/web/src/lib/actions/task/action.ts`
- Modify: `apps/web/src/lib/services/task.service.ts`
- Modify: `apps/web/src/lib/actions/task/__tests__/action.test.ts`

**Interfaces:**
- Consumes: optional `name` on the generated core create-task body (Task 3).
- Produces: `taskService.createTask` accepts input without `name`.

- [ ] **Step 1: Make `name` optional in the service input type**

In `apps/web/src/lib/services/task.service.ts`, change the `CreateTaskInput`
interface (line ~34) from:

```typescript
interface CreateTaskInput {
  name: string;
  description: string | null;
  coworkerId: string | null;
  projectId?: string | null;
  status?: Extract<TaskStatus, "DRAFT" | "READY">;
}
```

to:

```typescript
interface CreateTaskInput {
  name?: string;
  description: string | null;
  coworkerId: string | null;
  projectId?: string | null;
  status?: Extract<TaskStatus, "DRAFT" | "READY">;
}
```

- [ ] **Step 2: Remove naming from `createTaskFromDescription`**

In `apps/web/src/lib/actions/task/action.ts`, replace the
`createTaskFromDescription` function body (currently lines ~131–166) with:

```typescript
async function createTaskFromDescription(input: {
  description: string;
  coworkerId: string | null;
  projectId?: string | null;
  skipDesignMdAttachment?: boolean;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
}): Promise<Task> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    throw new Error("Description required");
  }

  const normalizedProjectId = normalizeOptionalProjectId(input.projectId);
  const descriptionWithDesignMd = input.skipDesignMdAttachment
    ? trimmedDescription
    : await designMdService.appendDesignMdToDescription(trimmedDescription);

  return taskService.createTask({
    description: descriptionWithDesignMd,
    coworkerId: input.coworkerId ? input.coworkerId : null,
    projectId: normalizedProjectId ?? null,
    status: input.status,
  });
}
```

- [ ] **Step 3: Remove the now-unused helper and imports**

In the same file:
- Delete the `buildFallbackName` function (lines ~87–91).
- Delete line 12: `import { openrouterClient } from "@/lib/clients/openrouter.client";`
- Delete line 16: `import { removeDesignMdAttachmentLinks } from "@sokosumi/utils";`
- Keep line 17 `clampTaskNameForCoreApi` import — still used by `updateTask`.

- [ ] **Step 4: Update the task action test**

In `apps/web/src/lib/actions/task/__tests__/action.test.ts`:
- Delete the `vi.mock("@/lib/clients/openrouter.client", ...)` block (lines ~44–48).
- Delete `const generateTaskNameMock = vi.fn();` (line ~29) and its
  `.mockReset()` (line ~107).
- Delete the `it(...)` blocks that asserted web-side naming behavior — the ones
  driving `generateTaskNameMock` and asserting `createTask` was called with a
  `name` (the long-name clamp test ~line 171, the "passes description to
  generateTaskName" test ~line 192, and the fallback test ~line 219). These
  behaviors are now covered by `apps/core/src/helpers/task-name.test.ts` and
  `apps/core/src/routes/v1/tasks/post.test.ts`.
- For any remaining test that asserts `taskServiceMock.createTask` was called,
  update the expected argument to omit `name`, e.g.:

```typescript
    expect(taskServiceMock.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Created related task",
        coworkerId: null,
        status: "DRAFT",
      }),
    );
```

  and assert it was called **without** a name:

```typescript
    expect(taskServiceMock.createTask.mock.calls[0][0]).not.toHaveProperty(
      "name",
    );
```

- Remove the now-unused `DEFAULT_TASK_NAME_MAX_LENGTH` import if it is no longer
  referenced after deleting the clamp test.

- [ ] **Step 5: Lint + run the web task tests**

Run: `pnpm web:check`
Expected: no errors (no unused imports/symbols).

Run: `pnpm --filter web test actions/task`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/actions/task/action.ts \
  apps/web/src/lib/services/task.service.ts \
  apps/web/src/lib/actions/task/__tests__/action.test.ts
git commit -m "refactor(web): let core name tasks on create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Stop generating job names in web

Core's `resolveJobName` already generates a job name when none is supplied.
Remove the web pre-generation and stop passing `name` to `createAgentJob`.

**Files:**
- Modify: `apps/web/src/lib/actions/job/action.ts`
- Modify: `apps/web/src/lib/actions/job/__tests__/action.test.ts`

**Interfaces:**
- Consumes: core `startJob` / `createAgentJob` already derives the name when
  `name` is absent (existing `resolveJobName` in `apps/core/src/helpers/job.ts`).

- [ ] **Step 1: Remove the job-name helpers**

In `apps/web/src/lib/actions/job/action.ts`:
- Delete `normalizeCoreJobName` (lines ~38–43).
- Delete the `generateCoreJobNameForJobStart` function and its doc comment
  (lines ~138–177).

- [ ] **Step 2: Stop computing/passing the generated name**

Delete the `generatedName` block (lines ~342–352):

```typescript
      const generatedName =
        agentRow == null
          ? null
          : await generateCoreJobNameForJobStart(
              parsed.agentId,
              {
                name: agentRow.name,
                description: agentRow.description,
              },
              coreInputData,
            );
```

In the `coreClient.createAgentJob(parsed.agentId, { ... })` call, delete the
line:

```typescript
        ...(generatedName ? { name: generatedName } : {}),
```

- [ ] **Step 3: Remove the now-unused imports**

In the same file:
- Delete the import `import { openrouterClient } from "@/lib/clients/openrouter.client";`
- Remove `JOB_NAME_MAX_LENGTH` from the `@/lib/schemas` import block (it was
  only used by `normalizeCoreJobName`).
- Change `import { type CoreJobInputData, toCoreJobInputData } from "@/lib/actions/job/core-job-input";`
  to `import { toCoreJobInputData } from "@/lib/actions/job/core-job-input";`
  (`CoreJobInputData` was only used by the deleted function).

- [ ] **Step 4: Update the job action test**

In `apps/web/src/lib/actions/job/__tests__/action.test.ts`:
- Delete the `vi.mock("@/lib/clients/openrouter.client", ...)` block (lines ~88–91).
- Delete `const generateJobNameMock = vi.fn();` (line ~60) and every
  `generateJobNameMock` reference (`.mockResolvedValue(...)` setups and the
  `expect(generateJobNameMock)...` assertions at lines ~160, ~223, ~244, ~272,
  ~335, ~372).
- For each `expect(createAgentJobMock).toHaveBeenCalledWith("agent-1", {...})`
  that included a generated `name` (lines ~153, ~205, ~313), remove the `name`
  property from the expected object and instead assert no name is sent:

```typescript
    expect(createAgentJobMock.mock.calls[0][1]).not.toHaveProperty("name");
```

  (One test near line 318 already asserts this; mirror it for the others.)

- [ ] **Step 5: Lint + run the web job tests**

Run: `pnpm web:check`
Expected: no errors.

Run: `pnpm --filter web test actions/job`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/actions/job/action.ts \
  apps/web/src/lib/actions/job/__tests__/action.test.ts
git commit -m "refactor(web): let core name jobs on start

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Delete the web OpenRouter client, dependency, and secret

With no remaining consumers, remove the client file, its barrel re-export, the
env secret, the npm dependency, and the `.env` entry.

**Files:**
- Delete: `apps/web/src/lib/clients/openrouter.client.ts`
- Modify: `apps/web/src/lib/clients/index.ts`
- Modify: `apps/web/src/config/env.secrets.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/.env` (local secret file; not tracked)

- [ ] **Step 1: Verify there are no remaining importers**

Run: `grep -rn "openrouter" apps/web/src`
Expected: no matches outside generated client files (`generated/core/*`). If
`openrouter.client` is still imported anywhere, fix that first.

- [ ] **Step 2: Delete the client and its re-export**

```bash
git rm apps/web/src/lib/clients/openrouter.client.ts
```

In `apps/web/src/lib/clients/index.ts`, delete the line:

```typescript
export * from "./openrouter.client";
```

- [ ] **Step 3: Remove the env secret**

In `apps/web/src/config/env.secrets.ts`, delete the OpenRouter field and its
comment (lines ~38–39):

```typescript
  // OpenRouter
  OPENROUTER_DEFAULT_API_KEY: z.string().startsWith("sk-or-").optional(),
```

- [ ] **Step 4: Remove the dependency**

In `apps/web/package.json`, delete the line:

```json
    "@openrouter/ai-sdk-provider": "2.9.1",
```

(Keep `"ai"` — the chat UI still uses it.) Then refresh the lockfile:

Run: `pnpm install`
Expected: lockfile updates, removing `@openrouter/ai-sdk-provider` from web.

- [ ] **Step 5: Remove the secret from the local `.env`**

In `apps/web/.env`, delete the `OPENROUTER_DEFAULT_API_KEY=...` line.
(`.env.example` never contained it — no change needed.)

- [ ] **Step 6: Full verification**

Run: `pnpm --filter @sokosumi/utils build && pnpm check`
Expected: clean.

Run: `pnpm core:test && pnpm web:test`
Expected: PASS.

Run: `pnpm web:build && pnpm core:build`
Expected: both succeed.

Run: `grep -rn "@openrouter/ai-sdk-provider\|OPENROUTER_DEFAULT_API_KEY" apps/web/src apps/web/package.json apps/web/.env`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/clients/index.ts \
  apps/web/src/config/env.secrets.ts \
  apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): remove openrouter client and dependency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(`apps/web/.env` is gitignored and is not part of the commit; the
`openrouter.client.ts` deletion is already staged by `git rm` in Step 2.)

---

## Self-Review

**Spec coverage:**
- Move `removeDesignMdAttachmentLinks` to utils → Task 1. ✅
- Core `generateTaskName` → Task 2 (Step 1). ✅
- Core `resolveTaskName` (strip/generate/fallback/clamp, before transaction) →
  Task 2 + Task 3. ✅
- `tasks/post` `name` optional + client regen → Task 3. ✅
- Web `createTaskFromDescription` stops naming; `CreateTaskInput.name` optional
  → Task 4. ✅
- Web job naming removal → Task 5. ✅
- Delete web client, barrel re-export, env secret, dependency, `.env` entry →
  Task 6. ✅
- Keep `ai`; keep `updateTask` clamp → Tasks 4/6 honor this. ✅

**Deviation from spec (intentional):** the spec listed a standalone
`generateTaskName` unit test. Core's sibling wrappers (`generateJobName`,
`generateChatTitle`, `generateAgentSummary`) have no isolated unit tests, and a
provider-mock unit test for a 15-line prompt wrapper is brittle and
inconsistent with the codebase. `generateTaskName` is instead covered through
`resolveTaskName` tests (Task 2, client mocked) and the route integration test
(Task 3). This is the maintainable, convention-consistent choice.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Test
files that are too large to reproduce in full (web `action.test.ts` files) have
exact mock-block removals and exact replacement assertions, with named `it()`
blocks to delete and the reason.

**Type consistency:** `resolveTaskName({ name?, description? })` and
`generateTaskName(description: string)` are referenced identically across Tasks
2/3. `CreateTaskInput.name?` (Task 4) matches the regenerated optional body
field (Task 3). `TASK_NAME_MAX_LENGTH = 120` matches the schema `max(120)`.

## Execution order / dependencies

Tasks are sequential: 1 → 2 → 3 → 4 → 5 → 6. Task 3 must precede Task 4 (web
relies on the regenerated optional `name`). Task 6 must come last (it deletes
the client only after Tasks 4–5 remove the last consumers). The repository
builds and tests green after every task.
