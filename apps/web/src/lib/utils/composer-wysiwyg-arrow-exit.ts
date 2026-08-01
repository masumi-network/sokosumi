/**
 * Exit an inline format mark when the caret is at its boundary and the user
 * presses ArrowLeft (start) or ArrowRight (end) — like Slack/word processors.
 */

const INLINE_FORMAT_TAGS = new Set([
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

function deepestInlineFormat(
  node: Node | null,
  editor: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);

  while (current && current !== editor) {
    if (INLINE_FORMAT_TAGS.has(current.tagName)) {
      if (current.tagName === "CODE" && current.closest("pre")) {
        current = current.parentElement;
        continue;
      }
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Text offset of the collapsed caret within `element`, or null if the caret
 * is not inside that element.
 */
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

  if (!(container instanceof Node) || !element.contains(container)) {
    if (container !== element) return null;
  }

  // Caret is expressed as a child-index offset on an element node.
  let total = 0;
  const children = container.childNodes;
  for (let index = 0; index < offset && index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    if (element === container || element.contains(child)) {
      total += child.textContent?.length ?? 0;
    }
  }

  if (container === element || element.contains(container)) {
    return total;
  }

  return null;
}

function placeCaretBefore(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartBefore(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAfter(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isVisuallyEmptyMark(element: HTMLElement): boolean {
  const text = (element.textContent ?? "").replace(/\u200b/g, "");
  return text.length === 0;
}

/**
 * If the collapsed caret sits at the start/end of an inline mark and the
 * matching arrow is pressed, move the caret just outside that mark and return
 * true (caller should preventDefault + refresh toolbar state).
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

  const mark = deepestInlineFormat(selection.anchorNode, editor);
  if (!mark) return false;

  const textOffset = caretTextOffsetInElement(
    mark,
    selection.anchorNode,
    selection.anchorOffset,
  );
  if (textOffset === null) return false;

  const textLength = mark.textContent?.length ?? 0;

  if (direction === "right" && textOffset >= textLength) {
    placeCaretAfter(mark);
    if (isVisuallyEmptyMark(mark)) mark.remove();
    return true;
  }

  if (direction === "left" && textOffset <= 0) {
    placeCaretBefore(mark);
    if (isVisuallyEmptyMark(mark)) mark.remove();
    return true;
  }

  return false;
}
