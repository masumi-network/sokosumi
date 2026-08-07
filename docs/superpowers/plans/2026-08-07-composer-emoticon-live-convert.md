# Live Composer Emoticon Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert classic ASCII emoticons (`:D`, `;)`, `:-)`, etc.) to Unicode emoji in the room WYSIWYG composer when closed by a boundary, using the same `emoticon` map as post-send `remark-emoji`.

**Architecture:** Pure `matchEmoticonClosedAtBoundary` util builds a longest-first map from the `emoticon` package. `ComposerWysiwygEditor.handleInput` runs it after shortcode auto-insert and replaces the match in the contentEditable the same way shortcodes do. Blur and submit flush bare trailing emoticons with `flush: true`.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library, `emoticon@4.1.0`, existing composer WYSIWYG utilities.

**Spec:** `docs/superpowers/specs/2026-08-07-composer-emoticon-live-convert-design.md`

## Global Constraints

- Surface: room/coworker `ComposerWysiwygEditor` only — do **not** change `MultimodalInput` / `PromptInputTextarea`
- Timing: convert only on boundary (whitespace or `. ! ? , ; :`) or flush at end-of-input (blur/send)
- Emoticon set: full `emoticon` package list (parity with `remark-emoji` `{ emoticon: true }`)
- Shortcode closed match runs **before** emoticon match
- Skip `CODE` / `PRE` / mention spans
- Pin exact versions (no `^`/`~`); `emoticon` direct dep at lockfile version `4.1.0`
- Conventional Commits; Biome format; TDD (failing test → implement → pass → commit)
- Do not change post-send `Markdown` / `remark-emoji` options

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/package.json` | Pin direct `emoticon@4.1.0` dependency |
| `apps/web/src/lib/utils/composer-emoticons.ts` | Pure boundary matcher + map from `emoticon` |
| `apps/web/src/lib/utils/__tests__/composer-emoticons.test.ts` | Unit tests for matcher |
| `apps/web/src/components/chat/composer-wysiwyg-editor.tsx` | Wire live replace + blur/submit flush |
| `apps/web/src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx` | Integration tests for typing / code / flush |

**Do not modify:** `markdown.tsx`, `multimodal-input.tsx`, `prompt-input.tsx`, Core API, database.

---

### Task 1: Pure matcher + pin `emoticon`

**Files:**
- Modify: `apps/web/package.json` (add `"emoticon": "4.1.0"` under `dependencies`, alphabetically near `embla-carousel-react` / `fake-indexeddb`)
- Create: `apps/web/src/lib/utils/composer-emoticons.ts`
- Create: `apps/web/src/lib/utils/__tests__/composer-emoticons.test.ts`

**Interfaces:**
- Consumes: `{ emoticon }` from `emoticon@4.1.0`
- Produces:

```ts
export interface ComposerEmoticonMatch {
  start: number;
  end: number;
  emoji: string;
}

export function matchEmoticonClosedAtBoundary(
  text: string,
  caret: number,
  options?: { flush?: boolean },
): ComposerEmoticonMatch | null;
```

- [ ] **Step 1: Pin dependency**

In `apps/web/package.json` `dependencies`, add:

```json
"emoticon": "4.1.0",
```

Run from repo root:

```bash
pnpm install --filter web
```

Expected: lockfile updates if needed; `emoticon@4.1.0` resolvable from web.

- [ ] **Step 2: Write failing unit tests**

Create `apps/web/src/lib/utils/__tests__/composer-emoticons.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { matchEmoticonClosedAtBoundary } from "@/lib/utils/composer-emoticons";

describe("matchEmoticonClosedAtBoundary", () => {
  it("converts :D before a trailing space", () => {
    const text = "hi :D ";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).toEqual({
      start: 3,
      end: 5,
      emoji: "😄",
    });
  });

  it("converts wink before sentence punctuation", () => {
    const text = "wink ;).";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).toEqual({
      start: 5,
      end: 7,
      emoji: "😉",
    });
  });

  it("prefers longest match :-)", () => {
    const text = ":-) ";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).toEqual({
      start: 0,
      end: 3,
      emoji: "😃",
    });
  });

  it("returns null without a boundary (live mode)", () => {
    const text = ":D";
    expect(matchEmoticonClosedAtBoundary(text, text.length)).toBeNull();
    expect(matchEmoticonClosedAtBoundary(":Dfoo", 5)).toBeNull();
  });

  it("matches at end-of-input in flush mode", () => {
    const text = "ok :)";
    expect(matchEmoticonClosedAtBoundary(text, text.length, { flush: true })).toEqual({
      start: 3,
      end: 5,
      emoji: "😃",
    });
  });

  it("does not match mid-URL (left guard)", () => {
    const text = "http:// ";
    expect(matchEmoticonClosedAtBoundary(text, text.length)).toBeNull();
  });

  it("keeps boundary character outside [start, end)", () => {
    const text = ":D ";
    const match = matchEmoticonClosedAtBoundary(text, text.length);
    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.end)).toBe(":D");
    expect(text[match!.end]).toBe(" ");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
pnpm --filter web test src/lib/utils/__tests__/composer-emoticons.test.ts
```

Expected: FAIL (module not found / function undefined).

- [ ] **Step 4: Implement matcher**

Create `apps/web/src/lib/utils/composer-emoticons.ts`:

```ts
import { emoticon } from "emoticon";

export interface ComposerEmoticonMatch {
  start: number;
  end: number;
  emoji: string;
}

const BOUNDARY_PUNCT = new Set([".", "!", "?", ",", ";", ":"]);

/** Longest-first emoticon → emoji map from the same source as remark-emoji. */
const EMOTICON_ENTRIES: ReadonlyArray<{ text: string; emoji: string }> = (() => {
  const byText = new Map<string, string>();
  for (const entry of emoticon) {
    for (const ascii of entry.emoticons) {
      if (!byText.has(ascii)) {
        byText.set(ascii, entry.emoji);
      }
    }
  }
  return [...byText.entries()]
    .map(([text, emoji]) => ({ text, emoji }))
    .sort((a, b) => b.text.length - a.text.length);
})();

function isWhitespace(char: string | undefined): boolean {
  return char != null && char.trim() === "";
}

function isLiveBoundaryChar(char: string | undefined): boolean {
  if (char == null || char === "") return false;
  return isWhitespace(char) || BOUNDARY_PUNCT.has(char);
}

/**
 * Match a complete ASCII emoticon closed at caret by a boundary (or flush).
 * `end` is exclusive of the emoticon only — boundary char is not consumed.
 */
export function matchEmoticonClosedAtBoundary(
  text: string,
  caret: number,
  options?: { flush?: boolean },
): ComposerEmoticonMatch | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const flush = options?.flush === true;

  let windowEnd: number;
  if (flush && clampedCaret === text.length) {
    windowEnd = clampedCaret;
  } else if (clampedCaret > 0 && isLiveBoundaryChar(text[clampedCaret - 1])) {
    windowEnd = clampedCaret - 1;
  } else {
    return null;
  }

  if (windowEnd <= 0) return null;
  const window = text.slice(0, windowEnd);

  for (const entry of EMOTICON_ENTRIES) {
    if (!window.endsWith(entry.text)) continue;
    const start = windowEnd - entry.text.length;
    const charBefore = start > 0 ? text[start - 1] : undefined;
    if (start > 0 && !isWhitespace(charBefore)) continue;
    return { start, end: windowEnd, emoji: entry.emoji };
  }

  return null;
}
```

Notes for implementer:
- Emoji glyphs (`😄` for `:D`, `😃` for `:)`, `😉` for `;)`) come from `emoticon` package; if a test glyph drifts, assert against `match` from the package rather than inventing alternates.
- First-writer-wins when the same ASCII appears on multiple entries (map uses first `emoticon` list order).

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter web test src/lib/utils/__tests__/composer-emoticons.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/utils/composer-emoticons.ts apps/web/src/lib/utils/__tests__/composer-emoticons.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): add composer emoticon boundary matcher

Pure matchEmoticonClosedAtBoundary using the emoticon package
map for live conversion parity with remark-emoji.
EOF
)"
```

---

### Task 2: Live replace in `handleInput`

**Files:**
- Modify: `apps/web/src/components/chat/composer-wysiwyg-editor.tsx`
- Modify: `apps/web/src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx`

**Interfaces:**
- Consumes: `matchEmoticonClosedAtBoundary` from `@/lib/utils/composer-emoticons`
- Consumes (existing): `findPositionForOffset`, `setCaretAfterNode`, `serializeEditor` / `syncFromEditor`, shortcode replace pattern in `handleInput`
- Produces: no new exported API; live emoticon conversion on input

- [ ] **Step 1: Write failing integration tests**

Append to `apps/web/src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx` (same patterns as emoji shortcode popup tests — set `textContent`, collapse selection to end, `fireEvent.input`):

```tsx
  it("converts :D to emoji after trailing space", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.textContent = ":D ";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(editor);

    expect(editor.textContent).toContain("😄");
    expect(editor.textContent).not.toContain(":D");
  });

  it("does not convert emoticons inside inline code", () => {
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.innerHTML = "<code>:D </code>";
    const code = editor.querySelector("code");
    expect(code).toBeTruthy();
    const textNode = code!.firstChild as Text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(editor);

    expect(editor.textContent).toContain(":D");
    expect(editor.textContent).not.toContain("😄");
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter web test src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx
```

Expected: FAIL on “converts :D…” (still shows `:D`).

- [ ] **Step 3: Wire replace after shortcode block**

In `composer-wysiwyg-editor.tsx`:

1. Import:

```ts
import { matchEmoticonClosedAtBoundary } from "@/lib/utils/composer-emoticons";
```

2. Add a small protected-context helper near the top of the file (or colocated private function), mirroring input-rules:

```ts
const COMPOSER_PROTECTED_TAGS = new Set(["CODE", "PRE"]);

function isInsideComposerProtectedContext(
  node: Node | null,
  root: HTMLElement,
): boolean {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement) {
      if (COMPOSER_PROTECTED_TAGS.has(current.tagName)) return true;
      if (current.dataset.mentionKey) return true;
    }
    current = current.parentNode;
  }
  return false;
}
```

3. Extract a shared replace helper used by shortcode + emoticon (optional but preferred to avoid duplication):

```ts
function replaceRangeWithEmoji(
  editor: HTMLElement,
  start: number,
  end: number,
  emoji: string,
  nextChar: string | undefined,
): void {
  const startPos = findPositionForOffset(editor, start);
  const endPos = findPositionForOffset(editor, end);
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  range.deleteContents();

  const insert = shouldAppendTrailingSpace(nextChar)
    ? `${emoji} `
    : emoji;
  const textNode = document.createTextNode(insert);
  range.insertNode(textNode);
  setCaretAfterNode(editor, textNode);
}
```

**Important:** For emoticons the boundary character already remains in the DOM **after** `end`. Shortcode path uses `shouldAppendTrailingSpace` because it consumes the closing `:` with no trailing space guaranteed. Emoticon path must **not** delete the boundary and should insert **only** `emoji` (no extra space) so `"😄 "` does not become `"😄  "` when the typed space is still present.

So for emoticon specifically:

```ts
const insert = match.emoji; // do not append space; boundary stays
```

4. In `handleInput`, after the shortcode block succeeds-or-not, before suggestions:

```ts
    const selection = window.getSelection();
    const anchorNode =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).startContainer
        : null;

    const emoticonMatch = matchEmoticonClosedAtBoundary(text, caret);
    if (
      emoticonMatch &&
      editorRef.current &&
      !isInsideComposerProtectedContext(anchorNode, editorRef.current)
    ) {
      const startPos = findPositionForOffset(
        editorRef.current,
        emoticonMatch.start,
      );
      const endPos = findPositionForOffset(
        editorRef.current,
        emoticonMatch.end,
      );
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      range.deleteContents();

      const textNode = document.createTextNode(emoticonMatch.emoji);
      range.insertNode(textNode);
      // Place caret after emoji but before any trailing boundary already in DOM
      setCaretAfterNode(editorRef.current, textNode);
      isInternalChange.current = true;
      syncFromEditor();
      closeSuggestions();
      return;
    }
```

Keep shortcode block unchanged (still first).

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter web test src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx
```

Expected: new tests PASS; existing suite still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat/composer-wysiwyg-editor.tsx apps/web/src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx
git commit -m "$(cat <<'EOF'
feat(chat): convert emoticons live in room composer

After boundary, replace ASCII emoticons with emoji in the
WYSIWYG editor; skip code and mention protected contexts.
EOF
)"
```

---

### Task 3: Flush on blur and before submit

**Files:**
- Modify: `apps/web/src/components/chat/composer-wysiwyg-editor.tsx`
- Modify: `apps/web/src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx`

**Interfaces:**
- Consumes: `matchEmoticonClosedAtBoundary(text, caret, { flush: true })`
- Produces: flush conversion on blur timeout and on Enter-submit path

- [ ] **Step 1: Write failing flush tests**

```tsx
  it("converts bare trailing emoticon on blur (flush)", async () => {
    vi.useFakeTimers();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.textContent = ":)";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(editor);
    // Live mode should not convert without boundary
    expect(editor.textContent).toContain(":)");

    fireEvent.blur(editor);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(editor.textContent).toContain("😃");
    expect(editor.textContent).not.toContain(":)");
    vi.useRealTimers();
  });

  it("converts bare trailing emoticon before submit shortcut", () => {
    const onSubmitShortcut = vi.fn();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <ComposerWysiwygEditor
          value={value}
          onChange={setValue}
          mentions={{}}
          onSubmitShortcut={onSubmitShortcut}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.textContent = ";)";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.input(editor);

    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor.textContent).toContain("😉");
    expect(onSubmitShortcut).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter web test src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx
```

Expected: FAIL on flush/blur or submit conversion.

- [ ] **Step 3: Implement flush helper and call sites**

In `composer-wysiwyg-editor.tsx`, extract a `tryFlushEmoticonAtEnd` (or reuse replace logic) that:

1. Serializes editor text + caret at end.
2. Calls `matchEmoticonClosedAtBoundary(text, text.length, { flush: true })`.
3. If match and not in protected context at caret, replaces range with emoji and `syncFromEditor()`.

**Blur:** inside existing `handleBlur` timeout (same 150ms path that closes suggestions), call flush **before** `closeSuggestions()` so bare `:)` converts when leaving the field.

**Submit:** in the Enter key handler branch where `action === "submit"`, call flush **before** `onSubmitShortcut?.()` so the parent reads converted markdown from the latest `onChange`.

Pseudo:

```ts
  const tryFlushTrailingEmoticon = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const { text } = serializeEditor(editor);
    const match = matchEmoticonClosedAtBoundary(text, text.length, {
      flush: true,
    });
    if (!match) return;

    const selection = window.getSelection();
    const anchor =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).startContainer
        : editor;
    if (isInsideComposerProtectedContext(anchor, editor)) return;

    const startPos = findPositionForOffset(editor, match.start);
    const endPos = findPositionForOffset(editor, match.end);
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    range.deleteContents();
    const textNode = document.createTextNode(match.emoji);
    range.insertNode(textNode);
    setCaretAfterNode(editor, textNode);
    isInternalChange.current = true;
    syncFromEditor();
  }, [syncFromEditor]);
```

Wire:

```ts
// handleBlur timeout:
tryFlushTrailingEmoticon();
closeSuggestions();
// ...

// handleKeyDown submit branch:
tryFlushTrailingEmoticon();
onSubmitShortcut?.();
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter web test src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx src/lib/utils/__tests__/composer-emoticons.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Format / typecheck touched surface**

```bash
pnpm --filter web exec biome check --write src/lib/utils/composer-emoticons.ts src/lib/utils/__tests__/composer-emoticons.test.ts src/components/chat/composer-wysiwyg-editor.tsx src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx
pnpm --filter web typecheck
```

Expected: clean check; typecheck OK.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chat/composer-wysiwyg-editor.tsx apps/web/src/components/chat/__tests__/composer-wysiwyg-editor.test.tsx
git commit -m "$(cat <<'EOF'
feat(chat): flush trailing emoticons on blur and send

Convert bare end-of-input emoticons when leaving the room
composer or submitting so send matches typed intent.
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Boundary conversion (space / punct) | Task 1 + 2 |
| Same `emoticon` set as remark-emoji | Task 1 (`emoticon` package) |
| Room WYSIWYG only | Task 2–3 (only `composer-wysiwyg-editor`) |
| Shortcode first | Task 2 (order in `handleInput`) |
| Unicode in stored value | Task 2 (sync after DOM replace) |
| Skip CODE/PRE/mention | Task 2 protected check + test |
| Flush blur/send | Task 3 |
| Unit + integration tests | Task 1–3 |
| Pin direct `emoticon` dep | Task 1 |
| No MultimodalInput / Markdown changes | File map “Do not modify” |

## Self-review notes

- No TBD/placeholder steps; signatures stable across tasks (`start`/`end`/`emoji`, `flush?: boolean`).
- Emoticon replace must **not** double-append spaces (boundary already in DOM).
- Emoji codepoints asserted in tests match `emoticon@4.1.0` (`:D`→😄, `:)`→😃, `;)`→😉, `:-)`→😃).
