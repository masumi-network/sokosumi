# Message Edit Keyboard-First UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inline message edit keyboard-only: Enter saves, Escape cancels, Shift+Enter inserts newline; remove Save/Cancel buttons.

**Architecture:** Local change to `MessageEditComposer` inside `room-message-row.tsx`. Update `onKeyDown` (plain Enter → save), add `onBlur` (cancel only when draft unchanged), delete the button footer. Parent save/cancel handlers and `canSave` rules stay the same. Tests in `room-message-row.test.tsx` drive behavior via keyboard/blur instead of button clicks.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library + userEvent, next-intl (optional aria-label only).

**Spec:** `docs/superpowers/specs/2026-08-05-message-edit-keyboard-ux-design.md`

## Global Constraints

- Scope: message edit composer only — do **not** change `EditChannelDialog`, main room composer, or link dialog
- Enter (no Shift/Alt/Ctrl/Meta) → save when `canSave`; otherwise no-op
- Shift+Enter → newline (do not intercept)
- Escape → cancel when not `isSaving` (existing)
- Cmd/Ctrl+Enter → keep as save alias when `canSave`
- Blur: cancel if draft unchanged (trim vs original); if dirty, no-op (stay editing)
- No auto-save on blur; no visible keyboard-hint chrome
- `canSave` = `trimmed.length > 0 && trimmed !== originalContent.trim() && !isSaving`
- Conventional Commits; Biome format; pin no new deps
- When adding i18n keys, update `en.json`, `de.json`, `es.json`

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/app/(app)/chat/components/room-message-row.tsx` | `MessageEditComposer`: keys, blur, remove buttons |
| `apps/web/src/app/(app)/chat/components/__tests__/room-message-row.test.tsx` | Keyboard + blur interaction tests |
| `apps/web/messages/en.json` (and `de.json`, `es.json`) | Remove unused `App.Channels.Edit.save` / `cancel` if nothing else uses them; optional `composerAria` if adding aria-label |

**Do not modify:** `edit-channel-dialog.tsx`, `rooms-client.tsx` save/cancel wiring (props stay), `room-composer.tsx`.

---

### Task 1: Keyboard + blur message edit (TDD)

**Files:**
- Modify: `apps/web/src/app/(app)/chat/components/__tests__/room-message-row.test.tsx`
- Modify: `apps/web/src/app/(app)/chat/components/room-message-row.tsx` (`MessageEditComposer`, ~lines 1097–1157)
- Modify (if unused after code change): `apps/web/messages/en.json`, `de.json`, `es.json` under `App.Channels.Edit`

**Interfaces:**
- Consumes (unchanged props):
  - `value: string`
  - `originalContent: string`
  - `onChange: (value: string) => void`
  - `onSave: () => void`
  - `onCancel: () => void`
  - `isSaving: boolean`
- Produces: same external props; no new exported API. Behavior only.

- [ ] **Step 1: Replace button-based test with failing keyboard tests**

In `apps/web/src/app/(app)/chat/components/__tests__/room-message-row.test.tsx`, replace the existing `"renders inline editor when isEditing"` test with:

```tsx
  it("renders inline editor when isEditing without Save/Cancel buttons", () => {
    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit: vi.fn(),
    });

    expect(screen.getByDisplayValue("Original fixed")).toBeInTheDocument();
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit.save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit.cancel" }),
    ).not.toBeInTheDocument();
  });

  it("saves on Enter and cancels on Escape while editing", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit,
    });

    const textarea = screen.getByDisplayValue("Original fixed");
    textarea.focus();

    await user.keyboard("{Enter}");
    expect(onSaveEdit).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("does not save on Shift+Enter while editing", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit,
    });

    screen.getByDisplayValue("Original fixed").focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it("does not save on Enter when draft is unchanged", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original",
      onEditDraftChange: vi.fn(),
      onCancelEdit: vi.fn(),
      onSaveEdit,
    });

    screen.getByDisplayValue("Original").focus();
    await user.keyboard("{Enter}");
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it("cancels on blur when draft is unchanged", async () => {
    const user = userEvent.setup();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit: vi.fn(),
    });

    const textarea = screen.getByDisplayValue("Original");
    textarea.focus();
    await user.tab(); // move focus away → blur
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on blur when draft is dirty", async () => {
    const user = userEvent.setup();
    const onCancelEdit = vi.fn();

    renderRow({
      message: userMessage({ content: "Original" }),
      currentUserId: "user-1",
      onStartEdit: vi.fn(),
      isEditing: true,
      editDraft: "Original fixed",
      onEditDraftChange: vi.fn(),
      onCancelEdit,
      onSaveEdit: vi.fn(),
    });

    const textarea = screen.getByDisplayValue("Original fixed");
    textarea.focus();
    await user.tab();
    expect(onCancelEdit).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

Run:

```bash
pnpm --filter web test src/app/\(app\)/chat/components/__tests__/room-message-row.test.tsx
```

Expected:
- FAIL: Save/Cancel buttons still present (`queryByRole` finds them) and/or Enter does not call `onSaveEdit` / blur does not cancel.

- [ ] **Step 3: Implement `MessageEditComposer`**

Replace `MessageEditComposer` in `apps/web/src/app/(app)/chat/components/room-message-row.tsx` with:

```tsx
function MessageEditComposer({
  value,
  originalContent,
  onChange,
  onSave,
  onCancel,
  isSaving,
}: {
  value: string;
  originalContent: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const t = useTranslations("App.Channels");
  const trimmed = value.trim();
  const isUnchanged = trimmed === originalContent.trim();
  const canSave = trimmed.length > 0 && !isUnchanged && !isSaving;

  return (
    <div className="pt-0.5">
      <Textarea
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        disabled={isSaving}
        className="min-h-10 max-h-40 resize-none overflow-y-auto field-sizing-content px-3 py-2.5 leading-6"
        autoFocus
        aria-label={t("Edit.composerAria")}
        onBlur={() => {
          if (isSaving) return;
          if (isUnchanged) onCancel();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!isSaving) onCancel();
            return;
          }
          if (event.key !== "Enter") return;
          // Shift+Enter → newline (default)
          if (event.shiftKey) return;
          // Cmd/Ctrl+Enter keeps working as save alias; Alt+Enter ignored
          if (event.altKey) return;
          event.preventDefault();
          if (canSave) onSave();
        }}
      />
    </div>
  );
}
```

Notes for implementer:
- Remove the Save/Cancel button block entirely (`space-y-2` footer no longer needed; outer `pt-0.5` is enough).
- Plain Enter and Cmd/Ctrl+Enter both hit the same path once `event.key === "Enter"` and `!shiftKey` (meta/ctrl still call `preventDefault` + `onSave` when `canSave`).
- Do **not** re-introduce button chrome or a visible hint string.
- `Loader2` on the Save button goes away; if `Loader2` is unused elsewhere in this file after the change, leave other usages alone — only remove unused imports if Biome flags them.
- `Button` may still be used elsewhere in the file — do not remove the import if other components need it.

- [ ] **Step 4: Add i18n key for aria-label; drop unused save/cancel strings**

In `apps/web/messages/en.json` under `App.Channels.Edit` (today):

```json
"Edit": {
  "action": "Edit",
  "save": "Save",
  "cancel": "Cancel",
  "edited": "Edited"
}
```

Change to:

```json
"Edit": {
  "action": "Edit",
  "composerAria": "Edit message. Enter to save, Escape to cancel, Shift+Enter for a new line.",
  "edited": "Edited"
}
```

Mirror in `de.json` and `es.json` (same structure; translate `composerAria` appropriately, e.g. DE: `"Nachricht bearbeiten. Enter speichern, Escape abbrechen, Umschalt+Enter neue Zeile."` / ES: `"Editar mensaje. Intro para guardar, Escape para cancelar, Mayús+Intro para nueva línea."`).

Only remove `save` / `cancel` after confirming no remaining `t("Edit.save")` / `t("Edit.cancel")` under `App.Channels` (grep should show only the old MessageEditComposer usages, which this task deletes).

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter web test src/app/\(app\)/chat/components/__tests__/room-message-row.test.tsx
```

Expected: all tests in that file PASS.

If blur tests flake because `user.tab()` does not leave the only focusable control, use:

```tsx
import { fireEvent } from "@testing-library/react";
// ...
fireEvent.blur(textarea);
```

Prefer `user.tab()` first; switch to `fireEvent.blur` only if tab has nowhere to go in the isolated row render.

- [ ] **Step 6: Format + typecheck touched surface**

```bash
pnpm --filter web exec biome check --write src/app/\(app\)/chat/components/room-message-row.tsx src/app/\(app\)/chat/components/__tests__/room-message-row.test.tsx
pnpm --filter web typecheck
```

Expected: clean / no new errors in touched files.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/web/src/app/\(app\)/chat/components/room-message-row.tsx \
  apps/web/src/app/\(app\)/chat/components/__tests__/room-message-row.test.tsx \
  apps/web/messages/en.json \
  apps/web/messages/de.json \
  apps/web/messages/es.json

git commit -m "$(cat <<'EOF'
feat(chat): keyboard-first message edit UX

Enter saves, Escape cancels, Shift+Enter newlines;
remove Save/Cancel buttons; blur cancels when unchanged.
EOF
)"
```

---

### Task 2: Manual smoke (no code)

**Files:** none

- [ ] **Step 1: Manual checklist in local web**

With `pnpm web:dev` (and core if needed):

1. Open a room message you authored → Edit.
2. Change text → **Enter** → message updates; edit mode exits.
3. Edit again → **Escape** → discards, exits.
4. Edit → **Shift+Enter** → new line appears; still editing.
5. Edit, no changes → click elsewhere → exits edit mode.
6. Edit, change text → click elsewhere → stays in edit mode (still dirty).
7. Confirm channel **settings** dialog still has Save/Cancel (untouched).

- [ ] **Step 2: No commit** unless manual smoke found a bug (then fix under Task 1 and amend or follow-up commit).

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Remove Save/Cancel buttons | Task 1 |
| Enter saves when `canSave` | Task 1 |
| Escape cancels | Task 1 |
| Shift+Enter newline | Task 1 |
| Cmd/Ctrl+Enter alias | Task 1 (same Enter path) |
| Blur cancel if unchanged | Task 1 |
| Blur no-op if dirty | Task 1 |
| Enter no-op when not `canSave` | Task 1 |
| No visible hint chrome | Task 1 (aria only) |
| Out of scope: channel dialog / main composer | Global constraints |
| Tests updated | Task 1 |
| i18n cleanup / aria | Task 1 |
