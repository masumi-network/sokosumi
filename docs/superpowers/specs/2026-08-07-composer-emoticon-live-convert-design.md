# Design: Live emoticon conversion in room composer

**Date:** 2026-08-07  
**Status:** Approved  
**Scope:** `apps/web` only — room / coworker WYSIWYG message composer (`ComposerWysiwygEditor`).

## Problem

Sent chat messages convert classic ASCII emoticons (`:D`, `;)`, `:-)`, etc.) to Unicode emoji via `remark-emoji` with `{ emoticon: true }` in the `Markdown` renderer. The room composer does **not** convert them while typing: the user sees raw ASCII until after send. Emoji **shortcodes** (`:smile:`) already auto-insert in the composer; emoticons should feel the same once complete.

## Goals

- Convert classic emoticons to Unicode emoji **in the composer** as the user types.
- Trigger only when the emoticon is complete and closed by a **boundary** (space, sentence punctuation, or end-of-input on blur/send).
- Use the **same emoticon set** as post-send render (`emoticon` package used by `remark-emoji`).
- Persist Unicode in the composer markdown value (same as shortcode auto-insert).
- Skip conversion inside code/pre/mention protected contexts.
- Keep shortcode auto-insert behavior unchanged and first in line.

## Non-goals

- Agent/job plain textarea (`MultimodalInput` / `PromptInputTextarea`).
- Display-only overlay that leaves ASCII in the stored value.
- Changing post-send `Markdown` / `remark-emoji` rendering.
- A custom or reduced emoticon list (parity with render is intentional).
- Special undo beyond normal browser undo of the text insert.
- Live conversion of emoticons mid-word or without a boundary.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Timing | Convert when emoticon is complete **and** followed by space / sentence punct, or flush at end-of-input on blur/send |
| Emoticon set | Full `emoticon` package list (same source `remark-emoji` uses when `emoticon: true`) |
| Surface | Room / coworker **WYSIWYG** composer only (`ComposerWysiwygEditor`) |
| Approach | Pure boundary matcher + DOM replace next to existing shortcode auto-insert in `handleInput` |
| Stored value | Unicode emoji in markdown string |
| Shortcode order | Shortcode closed match runs **before** emoticon match |

## Current behavior

**After send** (`apps/web/src/components/markdown.tsx`):

```ts
[remarkEmoji, { emoticon: true }]
```

`remark-emoji@5` uses the `emoticon` package and a short-pattern scan so `:)`, `;-)`, `:D`, etc. become emoji in rendered messages (skipped in fenced code).

**In composer** (`ComposerWysiwygEditor.handleInput`):

1. Strip pasted inline colors.
2. Apply markdown input rules (`**bold**`, `_italic_`, etc.).
3. Sync editor → markdown value.
4. If exact closed shortcode (`:name:`) at caret → replace with emoji.
5. Open/close mention or shortcode suggestions.

Classic emoticons never hit step 4; they remain ASCII until `Markdown` renders the sent message.

## Target behavior

| Input | Composer result |
| --- | --- |
| `hello :D` + space | `hello 😄 ` (space kept) |
| `wink ;)` then `.` | `wink 😉.` |
| Bare `:)` at end, then blur or send | `😃` (flush / end-of-input boundary) |
| Inside inline/fenced code or mention chip | No conversion |
| `:smile:` shortcode | Unchanged existing path |
| `http://` | No conversion (left guard) |
| `:Dfoo` (no boundary) | No conversion |

Exact emoji characters follow the `emoticon` package (e.g. `:D` → 😄, `:)` → 😃, `;)` → 😉). Tests should assert against that map, not hardcode alternate glyphs that only appear in older docs.

## Architecture

### Pure util

**File:** `apps/web/src/lib/utils/composer-emoticons.ts`

- Import `{ emoticon }` from the `emoticon` package.
- Build a module-level map `emoticon string → emoji`, with keys ordered **longest-first**.
- Export:

```ts
matchEmoticonClosedAtBoundary(
  text: string,
  caret: number,
  options?: { flush?: boolean },
): { start: number; end: number; emoji: string } | null
```

- `end` is exclusive end of the emoticon only; the boundary character is **not** consumed.
- Pin `emoticon` as a **direct** dependency of `apps/web` at the exact version already in the lockfile (`4.1.0` at design time), per pinned-dependencies rules. Do not rely on transitive access alone.

### Integration

**File:** `apps/web/src/components/chat/composer-wysiwyg-editor.tsx`

In `handleInput`, after the existing shortcode replace block:

1. Call `matchEmoticonClosedAtBoundary(text, caret)`.
2. If match and caret is not in a protected context (`CODE` / `PRE` / mention), replace via the same DOM path as shortcodes: `findPositionForOffset` → range delete → insert emoji text node → set caret → `syncFromEditor` → close suggestions.

**Order in `handleInput`:**

1. Color strip + input rules  
2. Sync  
3. Shortcode closed → replace (existing)  
4. **Emoticon at boundary → replace (new)**  
5. Suggestions  

**Flush:** On blur and immediately before submit, if the serialized value ends with a complete emoticon with no trailing boundary, run the matcher with `flush: true` (caret = text length counts as boundary) and apply the same replace/sync path so bare trailing `:)` still converts.

### Protected contexts

Do not convert when the caret (or the matched range) sits inside:

- `CODE` / `PRE`
- Mention spans (`data-mention-key`)

Reuse the same protected-context idea as `tryApplyComposerInputRuleAtCaret` (DOM ancestry check before applying the replace).

## Match algorithm

1. **Boundary at caret**
   - **Live:** character before caret is whitespace **or** sentence punctuation (`. ! ? , ; :`).
   - **Flush:** caret at `text.length` counts as boundary with no trailing character.

2. **Window:** text before the boundary character (live: `text.slice(0, caret - 1)`; flush: full `text` up to caret).

3. **Longest suffix:** among map keys that are suffixes of the window, pick the longest.

4. **Left guard** (parity with `remark-emoji`’s `(^|\s)`): match start index must be `0` **or** the previous character must be whitespace. Prevents mid-token / mid-URL matches (`http://`).

5. Return `{ start, end, emoji }` for the emoticon span only.

**False positives** (e.g. `8)` → sunglasses after a space) are accepted for parity with post-send `remark-emoji` behavior.

## Testing

### Unit: `apps/web/src/lib/utils/__tests__/composer-emoticons.test.ts`

- `:D ` / `;)` / `:-)` produce the correct emoji and ranges.
- Longest match: `:-)` wins over `:)`.
- Left guard: no match inside `http://`.
- No boundary → null.
- Flush mode matches at end-of-input.
- Boundary character is outside `[start, end)`.

### Integration: extend `composer-wysiwyg-editor` tests

- Typing `:D` then space updates editor content / serialized markdown to include the emoji.
- No conversion inside inline code.
- Closed shortcode `:smile:` still converts via the existing path.

## Out of scope (reminders)

- Other composers (agent multimodal plain textarea).
- Changing render-side `remark-emoji` options or maps.
- Partial emoticon lists or user settings to disable auto-convert.

## Implementation notes

- Prefer pure functions + unit tests first; thin DOM wiring second (TDD-friendly).
- Do not hand-edit generated Core clients or unrelated packages.
- After substantial edits, run Biome check on touched files and the new/updated tests via `pnpm --filter web test` on the relevant paths.
