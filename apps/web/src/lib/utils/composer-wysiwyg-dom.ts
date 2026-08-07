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
 * Replace serialized offset range `[start, end)` with `insertText`.
 * Skips when either range endpoint is in a protected context.
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
  if (
    isInsideComposerProtectedContext(startPos.node, editor) ||
    isInsideComposerProtectedContext(endPos.node, editor)
  ) {
    return false;
  }

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  range.deleteContents();

  const textNode = document.createTextNode(insertText);
  range.insertNode(textNode);
  setCaretAfterNode(editor, textNode);
  return true;
}
