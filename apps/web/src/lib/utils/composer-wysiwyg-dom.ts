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
  if (box.caretBottom > box.visibleBottom) {
    return box.caretBottom - box.visibleBottom;
  }
  if (box.caretTop < box.visibleTop) {
    return box.caretTop - box.visibleTop;
  }
  return 0;
}

function collapsedCaretRect(range: Range): DOMRect | null {
  const clientRects = range.getClientRects();
  if (clientRects.length > 0) {
    return clientRects[clientRects.length - 1] ?? null;
  }

  const bounding = range.getBoundingClientRect();
  if (bounding.height > 0 || bounding.width > 0) {
    return bounding;
  }

  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === Node.TEXT_NODE && offset > 0) {
    const probe = document.createRange();
    probe.setStart(node, offset - 1);
    probe.setEnd(node, offset);
    const glyph = probe.getBoundingClientRect();
    if (glyph.height > 0 || glyph.width > 0) {
      return glyph;
    }
  }

  if (node instanceof HTMLElement) {
    return node.getBoundingClientRect();
  }
  if (node.parentElement) {
    return node.parentElement.getBoundingClientRect();
  }
  return null;
}

/**
 * Keep the caret inside the editor content box. Adjusts `scrollTop` only.
 * Skip range selections — format commands fire input while a highlight is
 * still selected, and the last client rect is not the caret.
 * Do not set scroll-margin on this overflowing host (mouse selection jumps).
 */
export function scrollComposerCaretIntoView(editor: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);
  const endContainer: Node = range.endContainer;
  if (!editor.contains(endContainer)) return;

  const caret = collapsedCaretRect(range);
  if (!caret) return;

  const box = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const padBottom = Number.parseFloat(style.paddingBottom) || 0;
  const delta = composerCaretScrollDelta({
    caretTop: caret.top,
    caretBottom: caret.bottom,
    visibleTop: box.top + padTop,
    visibleBottom: box.bottom - padBottom,
  });
  if (delta !== 0) {
    editor.scrollTop += delta;
  }
}
