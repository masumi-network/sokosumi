# Design: Keyboard-first message edit UX

**Date:** 2026-08-05  
**Status:** Approved  
**Scope:** `apps/web` only — inline message edit composer in chat rooms/threads.

## Problem

Inline message edit shows labeled **Save** and **Cancel** buttons under the textarea. That chrome is heavy for a short, focused edit. Escape already cancels; save requires a click or **Cmd/Ctrl+Enter**. Users want a keyboard-first flow: **Enter** saves, **Escape** cancels, no action buttons.

## Goals

- Remove Save/Cancel button row from message edit.
- **Enter** (no modifiers) saves when the draft is valid.
- **Escape** cancels when not saving.
- **Shift+Enter** inserts a newline.
- Keep existing save eligibility rules (non-empty, dirty, not in-flight).
- Update tests to match the new interaction model.

## Non-goals

- Channel / room settings dialog (multi-field form keeps explicit Save/Cancel).
- Main room composer send/newline policy.
- Composer “Add link” dialog or other edit surfaces.
- Visible on-screen keyboard hint text.
- Auto-save on blur.
- Changing edit entry points (hover/menu “Edit”), permissions, or Core edit API.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Surface | Message edit only (`MessageEditComposer`) |
| Buttons | Remove entirely |
| Save key | **Enter** (no Shift/Alt/Ctrl/Meta) |
| Newline | **Shift+Enter** |
| Cancel key | **Escape** (already present) |
| Cmd/Ctrl+Enter | Keep as save alias (low cost, muscle memory) |
| Mouse-only path | Keyboard only; no icon buttons, no hint chrome |
| Blur / click-away | Cancel if draft unchanged; if dirty, stay in edit mode (no auto-save, no discard) |
| Enter when not `canSave` | No-op (do not cancel, do not save) |

## Current behavior

`MessageEditComposer` in `apps/web/src/app/(app)/chat/components/room-message-row.tsx`:

- Textarea + Save / Cancel buttons.
- Escape → cancel (if not saving).
- Cmd/Ctrl+Enter → save when `canSave`.
- Plain Enter → newline (default textarea).

`canSave` today:

```ts
trimmed.length > 0 && trimmed !== originalContent.trim() && !isSaving
```

Parent wiring (`rooms-client`, `thread-panel`) is unchanged: still passes `onSaveEdit` / `onCancelEdit` / `editDraft` / `isSavingEdit`.

## Target behavior

### UI

- Single auto-focused textarea (existing styles).
- No Save/Cancel button row.
- Optional a11y only: `aria-label` (and/or `title`) describing Enter / Escape / Shift+Enter — **no** visible hint line.

### Keyboard

| Key | Action |
| --- | --- |
| **Enter** (no Shift/Alt/Ctrl/Meta) | `preventDefault`; call `onSave` if `canSave`; otherwise no-op |
| **Shift+Enter** | Default newline (do not intercept) |
| **Escape** | `preventDefault`; call `onCancel` if not `isSaving` |
| **Cmd/Ctrl+Enter** | `preventDefault`; call `onSave` if `canSave` (alias) |

While `isSaving`: textarea disabled; ignore Enter/Escape save/cancel handlers (same as today for Escape).

### Blur / click-away

| Draft state | On blur |
| --- | --- |
| Unchanged vs original (trim-aware, same idea as `canSave` dirty check) | Cancel edit (`onCancel`) if not saving |
| Dirty | No-op — stay in edit mode; user must Enter or Escape |

Do **not** auto-save on blur.

### Save eligibility

Unchanged from product rules:

- Non-empty after trim.
- Differs from original after trim.
- Not currently saving.

Empty draft + Enter → no-op (user uses Escape to exit).

## Implementation sketch

1. **`MessageEditComposer`** (`room-message-row.tsx`)
   - Delete button footer and related `Button` / `Loader2` usage if unused elsewhere in the function.
   - Update `onKeyDown`:
     - Escape → cancel (keep).
     - Enter without modifiers → save when `canSave`.
     - Keep Cmd/Ctrl+Enter → save when `canSave`.
     - Leave Shift+Enter alone.
   - Add `onBlur` handler for cancel-when-unchanged (guard `isSaving`).
   - While saving, parent already sets `isSaving`; keep disabled textarea.
   - Consider a saving affordance without buttons: rely on disabled field + existing parent toast/error paths; if a spinner was only on the Save button, omit or use a non-blocking status only if needed — prefer no new chrome.

2. **Tests** (`room-message-row.test.tsx`)
   - Replace “click Save / Cancel” with keyboard:
     - Enter → `onSaveEdit`
     - Escape → `onCancelEdit`
   - Assert no `Edit.save` / `Edit.cancel` buttons when editing.
   - Shift+Enter does not call `onSaveEdit`.
   - Enter when draft equals original → no `onSaveEdit`.
   - Optional: blur with unchanged draft → cancel; blur with dirty draft → no cancel.

3. **i18n**
   - `App.Channels.Edit.save` / `Edit.cancel` — remove only if unused after this change (grep). `Edit.edited` / `Edit.action` stay.

## Error handling

- Save failure remains parent responsibility (`handleSaveEdit` toast, stay in edit or exit per existing logic).
- No new error UI in the composer.

## Testing plan

- Unit: keyboard + blur cases above in `room-message-row.test.tsx`.
- Manual: edit message → Enter saves; Escape cancels; Shift+Enter multi-line; click away with no edits exits; click away with edits stays.

## Out of scope (explicit)

- `EditChannelDialog` footer buttons.
- Thread vs room parity beyond shared `MessageEditComposer` (both already use it via row props).
- Changing when “Edited” badge appears.
