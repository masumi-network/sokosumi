/**
 * Exit an inline format mark when the caret is at its boundary and the user
 * presses ArrowLeft (start) or ArrowRight (end) — like Slack/word processors.
 *
 * Blink/WebKit often keep "sticky" typing styles (queryCommandState) after the
 * caret leaves a mark; we clear those when DOM no longer backs them.
 */

const MARK_TAGS = new Set([
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "CODE",
  "A",
]);

const STICKY_COMMANDS = [
  "bold",
  "italic",
  "underline",
  "strikeThrough",
] as const;

type StickyCommand = (typeof STICKY_COMMANDS)[number];

function queryCommandActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function spanCarriesFormat(element: HTMLElement): boolean {
  if (element.tagName !== "SPAN") return false;
  const style = element.getAttribute("style");
  if (!style) return false;
  const normalized = style.toLowerCase();
  return (
    /font-weight\s*:\s*(bold|[5-9]00)/.test(normalized) ||
    /font-style\s*:\s*italic/.test(normalized) ||
    /text-decoration(?:-line)?\s*:[^;]*underline/.test(normalized) ||
    /text-decoration(?:-line)?\s*:[^;]*(line-through|strikethrough)/.test(
      normalized,
    )
  );
}

function isInlineFormatElement(element: HTMLElement): boolean {
  if (MARK_TAGS.has(element.tagName)) {
    if (element.tagName === "CODE" && element.closest("pre")) return false;
    return true;
  }
  return spanCarriesFormat(element);
}

function deepestInlineFormat(
  node: Node | null,
  editor: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);

  while (current && current !== editor) {
    if (isInlineFormatElement(current)) return current;
    current = current.parentElement;
  }

  return null;
}

function hasDomBold(node: Node | null, editor: HTMLElement): boolean {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (current && current !== editor) {
    if (
      current.tagName === "STRONG" ||
      current.tagName === "B" ||
      (current.tagName === "SPAN" &&
        /font-weight\s*:\s*(bold|[5-9]00)/i.test(
          current.getAttribute("style") ?? "",
        ))
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasDomItalic(node: Node | null, editor: HTMLElement): boolean {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (current && current !== editor) {
    if (
      current.tagName === "EM" ||
      current.tagName === "I" ||
      (current.tagName === "SPAN" &&
        /font-style\s*:\s*italic/i.test(current.getAttribute("style") ?? ""))
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasDomUnderline(node: Node | null, editor: HTMLElement): boolean {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (current && current !== editor) {
    if (
      current.tagName === "U" ||
      (current.tagName === "SPAN" &&
        /text-decoration(?:-line)?\s*:[^;]*underline/i.test(
          current.getAttribute("style") ?? "",
        ))
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasDomStrike(node: Node | null, editor: HTMLElement): boolean {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (current && current !== editor) {
    if (
      current.tagName === "S" ||
      current.tagName === "STRIKE" ||
      current.tagName === "DEL" ||
      (current.tagName === "SPAN" &&
        /text-decoration(?:-line)?\s*:[^;]*(line-through|strikethrough)/i.test(
          current.getAttribute("style") ?? "",
        ))
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function stickyCommandHasDom(
  command: StickyCommand,
  node: Node | null,
  editor: HTMLElement,
): boolean {
  switch (command) {
    case "bold":
      return hasDomBold(node, editor);
    case "italic":
      return hasDomItalic(node, editor);
    case "underline":
      return hasDomUnderline(node, editor);
    case "strikeThrough":
      return hasDomStrike(node, editor);
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

/**
 * Turn off sticky typing styles that are no longer backed by a DOM ancestor.
 */
export function clearStickyFormatsWithoutDom(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;
  let cleared = false;

  for (const command of STICKY_COMMANDS) {
    if (!queryCommandActive(command)) continue;
    if (stickyCommandHasDom(command, node, editor)) continue;
    try {
      document.execCommand(command);
      cleared = true;
    } catch {
      // ignore unsupported commands in test envs
    }
  }

  return cleared;
}

function visibleRangeText(range: Range): string {
  return range.toString().replace(/\u200b/g, "");
}

/**
 * True when no visible text remains after the caret inside `mark`.
 * Uses Range so trailing `<br>` (Chrome contentEditable) does not block exit.
 */
function isCaretAtEndOfMark(mark: HTMLElement, range: Range): boolean {
  try {
    const after = range.cloneRange();
    after.setEnd(mark, mark.childNodes.length);
    return visibleRangeText(after).length === 0;
  } catch {
    return false;
  }
}

function isCaretAtStartOfMark(mark: HTMLElement, range: Range): boolean {
  try {
    const before = range.cloneRange();
    before.setStart(mark, 0);
    return visibleRangeText(before).length === 0;
  } catch {
    return false;
  }
}

function caretTextOffsetInElement(
  element: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    if (!element.contains(container)) return null;
    let total = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node === container) return total + offset;
      total += node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    return null;
  }

  if (container !== element && !element.contains(container)) return null;

  let total = 0;
  const children = container.childNodes;
  for (let index = 0; index < offset && index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    total += child.textContent?.length ?? 0;
  }
  return total;
}

function placeCaretAfter(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;

  // Landing pad so sticky typing styles don't keep applying at the boundary.
  const pad = document.createTextNode("\u200b");
  node.parentNode?.insertBefore(pad, node.nextSibling);

  const nextRange = document.createRange();
  nextRange.setStart(pad, 1);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function placeCaretBeforeWithPad(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;

  const pad = document.createTextNode("\u200b");
  node.parentNode?.insertBefore(pad, node);

  const nextRange = document.createRange();
  nextRange.setStart(pad, 0);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function isVisuallyEmptyMark(element: HTMLElement): boolean {
  const text = (element.textContent ?? "").replace(/\u200b/g, "");
  return text.length === 0;
}

function hasAnyStickyFormat(): boolean {
  return STICKY_COMMANDS.some((command) => queryCommandActive(command));
}

/**
 * If the collapsed caret sits at the start/end of an inline mark and the
 * matching arrow is pressed, move the caret just outside that mark and clear
 * sticky typing styles. Also clears sticky styles at the editor edges when
 * the caret is already outside a mark but queryCommandState is still on.
 */
export function tryExitComposerInlineFormatOnArrow(
  editor: HTMLElement,
  direction: "left" | "right",
): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const anchor = selection.anchorNode;
  if (!anchor) return false;
  const anchorElement =
    anchor.nodeType === Node.TEXT_NODE
      ? anchor.parentElement
      : (anchor as Element);
  if (!anchorElement || !editor.contains(anchorElement)) return false;

  const range = selection.getRangeAt(0);
  const mark = deepestInlineFormat(selection.anchorNode, editor);

  if (mark) {
    if (direction === "right" && isCaretAtEndOfMark(mark, range)) {
      placeCaretAfter(mark);
      if (isVisuallyEmptyMark(mark)) mark.remove();
      clearStickyFormatsWithoutDom(editor);
      return true;
    }

    if (direction === "left" && isCaretAtStartOfMark(mark, range)) {
      placeCaretBeforeWithPad(mark);
      if (isVisuallyEmptyMark(mark)) mark.remove();
      clearStickyFormatsWithoutDom(editor);
      return true;
    }

    return false;
  }

  // Caret already outside a mark, but sticky typing style may still be on
  // (common after ArrowRight at end of a bold run in Chromium).
  if (!hasAnyStickyFormat()) return false;

  const offset = caretTextOffsetInElement(
    editor,
    selection.anchorNode,
    selection.anchorOffset,
  );
  if (offset === null) return false;
  const editorLength = (editor.textContent ?? "").replace(/\u200b/g, "").length;
  const visibleOffset = Math.min(
    offset,
    // rough: treat zwsp as invisible for edge checks via range when possible
    offset,
  );

  if (direction === "right") {
    try {
      const after = range.cloneRange();
      after.setEnd(editor, editor.childNodes.length);
      if (visibleRangeText(after).length === 0) {
        return clearStickyFormatsWithoutDom(editor);
      }
    } catch {
      if (visibleOffset >= editorLength) {
        return clearStickyFormatsWithoutDom(editor);
      }
    }
  }

  if (direction === "left") {
    try {
      const before = range.cloneRange();
      before.setStart(editor, 0);
      if (visibleRangeText(before).length === 0) {
        return clearStickyFormatsWithoutDom(editor);
      }
    } catch {
      if (visibleOffset <= 0) {
        return clearStickyFormatsWithoutDom(editor);
      }
    }
  }

  if (
    selection.anchorNode.nodeType === Node.TEXT_NODE &&
    selection.anchorNode.textContent === "\u200b"
  ) {
    return clearStickyFormatsWithoutDom(editor);
  }

  return false;
}
