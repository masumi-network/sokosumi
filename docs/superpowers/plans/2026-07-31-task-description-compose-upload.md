# Task Description Compose Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TaskForm description file attach use `uploadUserFileDirect` (no `taskId`, no silent draft) so New Task paperclip works again.

**Architecture:** Description attaches are compose content — mint a user Blob session, PUT bytes, insert the public URL as markdown. Drop all silent-draft / `resolvedTaskId` / cancel-`deleteTask` machinery from TaskForm. Activity comments keep `uploadTaskAttachment(taskId, …)`.

**Tech Stack:** Next.js App Router, React 19, Vitest + Testing Library, existing `uploadUserFileDirect` / `createTaskAttachmentUploadToast`

**Spec:** `docs/superpowers/specs/2026-07-31-task-description-compose-upload-design.md`

## Global Constraints

- Description attach always calls `uploadUserFileDirect` (create and edit); never `uploadTaskAttachment` from TaskForm
- Do not create a draft (or any task) as a side effect of attach
- Do not promote description URLs into TaskFile on save
- Do not change chat composer or task-activity uploads
- No new Core endpoints or Blob prefixes
- Keep existing upload progress toast + abort-on-unmount behavior
- Conventional commits; branch `cursor/fix-task-description-upload-8332`

## File map

| File | Role |
|------|------|
| `apps/web/src/app/(app)/tasks/components/task-form.tsx` | Remove silent draft; description attach → `uploadUserFileDirect`; restore simple `handleSave` / `handleCancel` |
| `apps/web/src/app/(app)/tasks/components/__tests__/task-form.test.tsx` | Mock user upload; replace silent-draft tests; retarget edit upload tests |
| `apps/web/src/app/(app)/tasks/components/create-task-modal.tsx` | Drop `attachNeedsDescription` label wiring |
| `apps/web/src/app/(app)/tasks/new/page.tsx` | Drop `attachNeedsDescription` label wiring |
| `apps/web/src/app/(app)/tasks/components/task-detail-actions.tsx` | Drop `attachNeedsDescription` label wiring |
| `apps/web/messages/{en,de,es,it,fr,pt,pt-BR,ja,zh-Hans}.json` | Remove `App.Tasks.NewTask.attachNeedsDescription` |

---

### Task 1: Failing tests for description compose upload

**Files:**
- Modify: `apps/web/src/app/(app)/tasks/components/__tests__/task-form.test.tsx`
- Test: same file

**Interfaces:**
- Consumes: `uploadUserFileDirect(file, options?) => Promise<{ publicUrl: string }>`
- Produces: tests that fail until Task 2 switches TaskForm to user upload

- [ ] **Step 1: Update mocks — remove deleteTask / task-attachment-only setup; add user upload mock**

Replace the hoisted mocks and related `vi.mock` blocks at the top of the test file with:

```tsx
const {
  markdownEditorPropsSpy,
  uploadUserFileDirectMock,
  toastCustomMock,
  toastDismissMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  markdownEditorPropsSpy: vi.fn(),
  uploadUserFileDirectMock: vi.fn(),
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/actions/task/action", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/lib/utils/task-attachments.client", () => ({
  uploadTaskAttachment: vi.fn(() => {
    throw new Error(
      "TaskForm must not call uploadTaskAttachment for description attaches",
    );
  }),
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: (...args: unknown[]) =>
    uploadUserFileDirectMock(...args),
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));
```

Remove `deleteTask` from the import of `@/lib/actions/task/action`.

- [ ] **Step 2: Rewrite progress / batch / error / abort tests to use `uploadUserFileDirectMock`**

For every test that currently does:

```ts
uploadTaskAttachmentMock.mockImplementation(
  (_taskId: string, _file: File, options?: { ... }) => ...
);
```

change to a **single-file** signature (no taskId):

```ts
uploadUserFileDirectMock.mockImplementation(
  (
    _file: File,
    options?: {
      abortSignal?: AbortSignal;
      onUploadProgress?: (progress: {
        loaded: number;
        total: number;
        percentage: number;
      }) => void;
    },
  ) =>
    new Promise<{ publicUrl: string }>((resolve, reject) => {
      // same progress / abort logic as before, but resolve({ publicUrl: "..." })
    }),
);
```

Replace assertions like `expect(uploadTaskAttachmentMock).toHaveBeenCalledTimes(N)` with `uploadUserFileDirectMock`. For batch test, resolve `{ publicUrl: "https://blob.example/first.pdf" }` / `second.pdf`.

Keep the same edit-mode render props (`mode="edit"`, `taskId="task-1"`, …) — description attach must still use user upload even when `taskId` exists.

- [ ] **Step 3: Replace silent-draft tests with compose-upload tests**

Delete these three tests entirely:

- `"creates a draft then uploads create-mode attachments via task files"`
- `"updates the silent draft on Create instead of creating a second task"`
- `"archives the silent draft when canceling after attach"`

Add:

```tsx
  it("uploads create-mode description attachments via user files without creating a task", async () => {
    const user = userEvent.setup();
    const file = new File(["notes"], "DESIGN.md", {
      type: "text/markdown",
    });
    const createTaskMock = vi.mocked(createTask);
    uploadUserFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/u1/DESIGN.md",
    });

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(1);
      expect(toastDismissMock).toHaveBeenCalled();
    });

    expect(uploadUserFileDirectMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("uploads edit-mode description attachments via user files, not task files", async () => {
    const user = userEvent.setup();
    const file = new File(["notes"], "notes.pdf", {
      type: "application/pdf",
    });
    uploadUserFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/u1/notes.pdf",
    });

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description: "Body",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(1);
      expect(toastDismissMock).toHaveBeenCalled();
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run tests — expect failures until Task 2**

Run:

```bash
pnpm --filter web test src/app/\(app\)/tasks/components/__tests__/task-form.test.tsx
```

Expected: FAIL — create-mode attach still hits silent draft / `uploadTaskAttachment`, or mocks throw / `createTask` still called.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/tasks/components/__tests__/task-form.test.tsx
git commit -m "test(tasks): expect description attach via user file upload"
```

---

### Task 2: Switch TaskForm description attach to user upload; remove silent draft

**Files:**
- Modify: `apps/web/src/app/(app)/tasks/components/task-form.tsx`
- Test: `apps/web/src/app/(app)/tasks/components/__tests__/task-form.test.tsx`

**Interfaces:**
- Consumes: `uploadUserFileDirect` from `@/lib/utils/user-file-upload.client`
- Produces: description attach with no task side effects; simple create/update save

- [ ] **Step 1: Fix imports and labels**

In `task-form.tsx`:

```tsx
import { createTask, updateTask } from "@/lib/actions/task/action";
// remove deleteTask

// remove: import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";

import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";
```

Remove `attachNeedsDescription?: string` from `TaskFormLabels`.

- [ ] **Step 2: Remove silent-draft state/refs**

Delete these declarations (and their comments):

```tsx
const [resolvedTaskId, setResolvedTaskId] = useState(taskId);
const [resolvedTaskName, setResolvedTaskName] = useState(
  initialValues?.name ?? "",
);
const silentDraftSessionRef = useRef(false);
const ensureDraftPromiseRef = useRef<Promise<string> | null>(null);
```

- [ ] **Step 3: Restore simple `handleSave` (pre-silent-draft)**

Replace the entire `handleSave` callback with the create-vs-update shape from `main` (no `resolvedTaskId`, no draft-in-flight branch):

```tsx
  const handleSave = useCallback(
    async (overrideStatus?: TaskStatus) => {
      if (isSaveDisabled || (useWizard && step === 1)) return;
      if (overrideStatus && overrideStatus === TaskStatus.DRAFT) {
        setIsSubmittingDraft(true);
      } else {
        setIsSubmitting(true);
      }
      try {
        const trimmedDescription = description.trim();
        const desiredStatus = overrideStatus ?? status;
        if (mode === "create" && ["DRAFT", "READY"].includes(desiredStatus)) {
          const createTaskHandler = onCreateTask ?? createTask;
          const result = await createTaskHandler({
            description: trimmedDescription,
            assigneeId,
            skipDesignMdAttachment: isDesignMdAttachmentSkipped(
              designMdStateRef.current,
            ),
            ...(shouldShowProjectSelect ? { projectId } : {}),
            status: desiredStatus as Extract<TaskStatus, "DRAFT" | "READY">,
            schedule: scheduleSelection,
          });
          if (isModal) {
            const createdStatus =
              scheduleSelection.mode !== "none" &&
              desiredStatus !== TaskStatus.DRAFT
                ? "QUEUED"
                : desiredStatus === TaskStatus.DRAFT
                  ? "DRAFT"
                  : "READY";
            router.prefetch(`/tasks/${result.taskId}`);
            setCreatedTask({
              id: result.taskId,
              name: result.name?.trim() || "Untitled task",
              status: createdStatus,
              statusLabel:
                createdStatus === "QUEUED"
                  ? (labels.statusQueued ?? "Queued")
                  : createdStatus === "DRAFT"
                    ? labels.statusDraft
                    : labels.statusReady,
              scheduleLabel:
                createdStatus === "QUEUED"
                  ? (scheduleLabel ?? undefined)
                  : undefined,
            });
            onCreated?.(result.taskId);
            return;
          }
          if (onSuccess) {
            onSuccess(result.taskId);
            return;
          }
          router.push(`/tasks/${result.taskId}`);
          return;
        }

        if (!taskId) {
          throw new Error("Task ID is required");
        }

        const trimmedName = name.trim();
        await updateTask({
          taskId,
          name: trimmedName,
          description: trimmedDescription,
          assigneeId,
          ...(shouldShowProjectSelect ? { projectId } : {}),
          currentStatus: originalStatus,
          desiredStatus,
          schedule: scheduleSelection,
          hadSchedule,
          originalSchedule: originalScheduleSelection.current,
        });
        if (onSuccess) {
          onSuccess(taskId);
          return;
        }
        router.push(`/tasks/${taskId}`);
      } catch (error) {
        console.error("Failed to save task", error);
        toast.error("Failed to save task");
      } finally {
        setIsSubmitting(false);
        setIsSubmittingDraft(false);
      }
    },
    [
      description,
      isModal,
      isSaveDisabled,
      mode,
      step,
      useWizard,
      name,
      assigneeId,
      projectId,
      shouldShowProjectSelect,
      originalStatus,
      router,
      status,
      taskId,
      onSuccess,
      onCreated,
      onCreateTask,
      scheduleSelection,
      scheduleLabel,
      hadSchedule,
      labels.statusDraft,
      labels.statusQueued,
      labels.statusReady,
    ],
  );
```

- [ ] **Step 4: Replace `ensureDraftTaskId` + `handleAttachFiles` with user-file attach**

Delete `ensureDraftTaskId` entirely. Replace `handleAttachFiles` with:

```tsx
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const uploadToast = createTaskAttachmentUploadToast({
        files,
        labels: {
          uploadingFile: labels.uploadingFile,
          uploadingFiles: labels.uploadingFiles,
        },
      });

      const controller = new AbortController();
      activeUploadControllersRef.current.add(controller);
      setUploadingAttachmentsCount((count) => count + 1);
      try {
        for (const [index, file] of files.entries()) {
          const uploaded = await uploadUserFileDirect(file, {
            abortSignal: controller.signal,
            onUploadProgress: (progress) => {
              uploadToast.updateFileProgress(index, progress);
            },
          });
          uploadToast.markFileComplete(index);
          const safeName = sanitizeTaskAttachmentLabel(file.name, "file");
          if (markdownEditorRef.current) {
            markdownEditorRef.current.insertLink(safeName, uploaded.publicUrl);
            markdownEditorRef.current.insertText("\n");
            continue;
          }
          const markdownLink = formatTaskAttachmentMarkdown(
            safeName,
            uploaded.publicUrl,
          );
          setDescription(
            (prev) =>
              `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdownLink}`,
          );
        }
        uploadToast.dismiss();
      } catch (error) {
        uploadToast.dismiss();
        toast.error(
          getUserFileUploadErrorMessage(
            error,
            labels.uploadFileError ?? "Failed to upload file",
          ),
        );
      } finally {
        activeUploadControllersRef.current.delete(controller);
        setPendingUploadFiles([]);
        setUploadingAttachmentsCount((count) => count - 1);
      }
    },
    [labels.uploadFileError, labels.uploadingFile, labels.uploadingFiles],
  );
```

- [ ] **Step 5: Restore simple `handleCancel`**

```tsx
  const handleCancel = () => {
    abortActiveUploads();
    if (onCancel) {
      onCancel();
      return;
    }
    if (mode === "edit" && taskId) {
      router.push(`/tasks/${taskId}`);
      return;
    }
    router.push("/tasks");
  };
```

- [ ] **Step 6: Confirm paperclip always opens the file picker**

`onAttachClick` must be:

```tsx
onAttachClick={() => attachmentTriggerRef.current?.click()}
```

(not gated on `taskId`)

- [ ] **Step 7: Run tests — expect pass**

```bash
pnpm --filter web test src/app/\(app\)/tasks/components/__tests__/task-form.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(app\)/tasks/components/task-form.tsx \
  apps/web/src/app/\(app\)/tasks/components/__tests__/task-form.test.tsx
git commit -m "fix(tasks): use user file upload for task description attaches"
```

---

### Task 3: Remove unused `attachNeedsDescription` i18n + label wiring

**Files:**
- Modify: `apps/web/src/app/(app)/tasks/components/create-task-modal.tsx`
- Modify: `apps/web/src/app/(app)/tasks/new/page.tsx`
- Modify: `apps/web/src/app/(app)/tasks/components/task-detail-actions.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`
- Modify: `apps/web/messages/it.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/pt.json`
- Modify: `apps/web/messages/pt-BR.json`
- Modify: `apps/web/messages/ja.json`
- Modify: `apps/web/messages/zh-Hans.json`

**Interfaces:**
- Consumes: none
- Produces: no remaining references to `attachNeedsDescription`

- [ ] **Step 1: Remove label wiring**

Delete these lines (exact key):

```tsx
attachNeedsDescription: t("attachNeedsDescription"),
```

from `create-task-modal.tsx` and `new/page.tsx`, and:

```tsx
attachNeedsDescription: tNewTask("attachNeedsDescription"),
```

from `task-detail-actions.tsx`.

- [ ] **Step 2: Remove locale keys**

From every `apps/web/messages/*.json`, under `App.Tasks.NewTask`, delete:

```json
"attachNeedsDescription": "..."
```

Keep trailing commas valid JSON.

Verify no remaining references:

```bash
rg attachNeedsDescription apps/web
```

Expected: no matches.

- [ ] **Step 3: Format / check touched files**

```bash
pnpm --filter web exec biome check --write \
  src/app/\(app\)/tasks/components/task-form.tsx \
  src/app/\(app\)/tasks/components/__tests__/task-form.test.tsx \
  src/app/\(app\)/tasks/components/create-task-modal.tsx \
  src/app/\(app\)/tasks/components/task-detail-actions.tsx \
  src/app/\(app\)/tasks/new/page.tsx
```

Expected: clean or auto-fixed.

- [ ] **Step 4: Re-run tests + typecheck web**

```bash
pnpm --filter web test src/app/\(app\)/tasks/components/__tests__/task-form.test.tsx
pnpm --filter web typecheck
```

Expected: tests PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/tasks/components/create-task-modal.tsx \
  apps/web/src/app/\(app\)/tasks/new/page.tsx \
  apps/web/src/app/\(app\)/tasks/components/task-detail-actions.tsx \
  apps/web/messages
git commit -m "chore(i18n): remove unused attachNeedsDescription keys"
```

- [ ] **Step 6: Push and update PR body to match compose-upload approach**

```bash
git push -u origin cursor/fix-task-description-upload-8332
```

Update PR #3479 summary: description attach uses `uploadUserFileDirect`; silent draft removed; activity unchanged.

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Description → `uploadUserFileDirect` create+edit | Task 2 |
| No silent draft / no attach-side createTask | Task 2 |
| Markdown links only; no TaskFile promote | Task 2 (by omission) |
| Activity unchanged | Out of scope — no file touch |
| Chat unchanged | Out of scope — no file touch |
| Remove silent-draft tests; add compose tests | Task 1 |
| Remove `attachNeedsDescription` | Task 3 |
| Toast + abort preserved | Task 2 `handleAttachFiles` |

## Placeholder scan

No TBD / "similar to Task N" / vague steps. Exact commands and code included.
