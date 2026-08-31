import {
  findPositionForOffset,
  setCaretAfterNode,
} from "@/components/ui/mention-textarea-utils";

const COMPOSER_PROTECTED_TAGS = new Set(["CODE", "PRE"]);

/**
 * True when `node` sits inside CODE/PRE or a mention chip within `root`.
 * Used by input rules, shortcode replace, and emoticon convert.
 */
export function isInsideComposerProtectedContext(
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

/**
 * True when `range` intersects a CODE/PRE/mention element under `root`.
 * Endpoint-only checks miss a range that fully encloses a protected chip.
 */
export function rangeIntersectsComposerProtected(
  range: Range,
  root: HTMLElement,
): boolean {
  if (
    isInsideComposerProtectedContext(range.startContainer, root) ||
    isInsideComposerProtectedContext(range.endContainer, root)
  ) {
    return true;
  }

  const protectedNodes = root.querySelectorAll("code, pre, [data-mention-key]");
  for (const node of protectedNodes) {
    if (range.intersectsNode(node)) {
      return true;
    }
  }
  return false;
}

/**
 * Replace serialized offset range `[start, end)` with `insertText`.
 * Skips when the range intersects CODE/PRE/mention (endpoints or enclosed).
 * Leaves caret after the inserted text node. Returns false if skipped.
 */
export function replaceComposerTextRange(
  editor: HTMLElement,
  start: number,
  end: number,
  insertText: string,
): boolean {
  if (start < 0 || end < start) return false;

  const startPos = findPositionForOffset(editor, start);
  const endPos = findPositionForOffset(editor, end);

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  if (rangeIntersectsComposerProtected(range, editor)) {
    return false;
  }

  range.deleteContents();

  const textNode = document.createTextNode(insertText);
  range.insertNode(textNode);
  setCaretAfterNode(editor, textNode);
  return true;
}

export interface ComposerCaretScrollBox {
  caretTop: number;
  caretBottom: number;
  visibleTop: number;
  visibleBottom: number;
}

/**
 * How far a scrollport must move so the caret sits in the content box.
 * Chromium caret-scroll uses the padding box, so the last line can sit in
 * padding-bottom after max-height and look like the caret stopped following.
 */
export function composerCaretScrollDelta(box: ComposerCaretScrollBox): number {
  return 0;
}
