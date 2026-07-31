# Task description compose upload

**Date:** 2026-07-31  
**Branch / PR:** `cursor/fix-task-description-upload-8332` (#3479)  
**Status:** Draft — awaiting user review before planning

## Goal

Restore file attach on **New Task / task description** after #3469 without requiring a `taskId` first. Description attachments are compose content (markdown links), not TaskFile rows.

## Non-goals

- Chat room composer changes (stays on `uploadUserFileDirect` as today; SOK-668 later)
- Task activity / comment uploads (stay `uploadTaskAttachment`)
- Promoting description URLs into TaskFile / `tasks/{id}/…` on save
- New Core scratch/compose Blob prefix
- Domain-scoped upload work under SOK-665

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Scope | TaskForm description only |
| Upload API for description | Always `uploadUserFileDirect` (create and edit) |
| Activity | Unchanged task-scoped upload |
| On save | Leave URLs as markdown links only |
| Approach | Call `uploadUserFileDirect` directly in TaskForm — no thin wrapper |

## Problem

#3469 made task file uploads require `taskId` (`tasks/{taskId}/…` + TaskFile webhook). New Task has no id yet, so paperclip failed with "Failed to upload file".

An intermediate fix silently created a DRAFT on first attach. That works for TaskFile ownership but adds race/orphan complexity that is unnecessary for description markdown links.

## Approach (chosen)

**Direct `uploadUserFileDirect` in TaskForm for description attaches.**

- Same path chat uses today (`users/{userId}/…` mint → client PUT → public URL).
- Insert URL into description markdown; chips via `extractTaskAttachmentUrls`.
- Remove silent-draft machinery from TaskForm.

Alternatives rejected:

1. **Silent draft + `uploadTaskAttachment`** — correct for TaskFile, overweight for description links; orphan/race cost.
2. **Named `uploadDescriptionAttachment` wrapper** — no behavior win in this PR; defer until a second caller needs it.
3. **New Core compose prefix** — out of scope; belongs with SOK-665 family.

## Architecture

```
TaskForm description attach
  → uploadUserFileDirect(file)
  → publicUrl
  → markdown link in description
  → chips from extractTaskAttachmentUrls

Task activity attach (unchanged)
  → uploadTaskAttachment(taskId, file)
  → TaskFile via webhook
```

Create / Save as Draft / Create Task: persist description as today. No file promote step.

## Data flow

1. User picks file(s) via paperclip or dropzone.
2. Show existing task-attachment upload progress toast.
3. For each file: `uploadUserFileDirect(file, { abortSignal, onUploadProgress })`.
4. Insert link via `MarkdownEditor.insertLink` (fallback: append markdown to description).
5. Remove chip: strip matching links from description markdown.
6. Errors: `getUserFileUploadErrorMessage` + toast.
7. Cancel / unmount: abort in-flight PUTs only — no draft create/delete.

## Cleanup (revert silent-draft PR bits)

Remove from `task-form.tsx`:

- `resolvedTaskId` / `resolvedTaskName` state driven by silent draft
- `ensureDraftTaskId`, `ensureDraftPromiseRef`, `silentDraftSessionRef`
- Cancel-path `deleteTask` for abandoned drafts
- Create-mode branch that updates a silent draft instead of creating

Restore: paperclip always opens file picker; `handleSave` create vs update solely from `mode` + prop `taskId`.

Remove unused `attachNeedsDescription` label wiring and locale keys if nothing else references them.

Keep `deleteTask` unused in TaskForm (do not import).

## Testing

In `task-form.test.tsx`:

- Mock `uploadUserFileDirect` (+ keep `getUserFileUploadErrorMessage` helper mock).
- **Create mode (no taskId):** attach → `uploadUserFileDirect`; do **not** call `createTask` or `uploadTaskAttachment`.
- **Edit mode (with taskId):** description attach → `uploadUserFileDirect`, not `uploadTaskAttachment`.
- Remove tests that assert silent draft create, Create→`updateTask` after attach, cancel→`deleteTask`.
- Adapt progress-toast / abort tests to the user-upload mock where they currently call `uploadTaskAttachment` for description attaches in edit mode.

Activity tests unchanged.

## Follow-ups (explicitly later)

- Shared compose helper if chat + description want one name (`uploadComposeAttachment`).
- Domain-scoped prefixes (SOK-665 / SOK-668).
- Optional promote of description blob URLs into TaskFile on task create.

## Success criteria

- New Task description attach works without saving a draft first.
- No silent task rows created by attach alone.
- Edit description attach uses user upload; activity still task-scoped.
- Existing toast / abort UX preserved.
- Targeted `task-form` tests green.
