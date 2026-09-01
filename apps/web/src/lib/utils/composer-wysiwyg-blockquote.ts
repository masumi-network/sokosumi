/**
 * Slack/Discord-style blockquote leave: Shift+Enter on an empty last line
 * continues in a normal paragraph after the quote. Toolbar quote toggles wrap.
 */

function closestBlockquote(
  node: Node | null,
  editor: HTMLElement,
): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== editor) {
    if (current instanceof HTMLElement && current.tagName === "BLOCKQUOTE") {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function isBr(node: Node | null): boolean {
  return node instanceof HTMLElement && node.tagName === "BR";
}

function visibleText(node: Node): string {
  return (node.textContent ?? "").replace(/\u200b/g, "").trim();
}

function rangeToPrefixedText(fragmentRoot: Node): string {
  let out = "";
  function walk(node: Node): void {
    if (isBr(node)) {
      out += "\n";
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
    }
  }
  walk(fragmentRoot);
  return out.replace(/\u200b/g, "");
}

function isCaretAtEndOfQuote(quote: HTMLElement, range: Range): boolean {
  try {
    const after = range.cloneRange();
    after.setEnd(quote, quote.childNodes.length);
    return visibleText(after.cloneContents()).length === 0;
  } catch {
    return false;
  }
}

function isCurrentQuoteLineEmpty(quote: HTMLElement, range: Range): boolean {
  try {
    const prefix = document.createRange();
    prefix.setStart(quote, 0);
    prefix.setEnd(range.startContainer, range.startOffset);
    const text = rangeToPrefixedText(prefix.cloneContents());
    const lines = text.split("\n");
    const current = lines[lines.length - 1] ?? "";
    return current.trim().length === 0;
  } catch {
    return false;
  }
}

function isVisuallyEmptyQuote(quote: HTMLElement): boolean {
  return visibleText(quote).length === 0;
}

function trimTrailingBreaks(quote: HTMLElement): void {
  while (quote.lastChild) {
    const last = quote.lastChild;
    if (isBr(last)) {
      last.remove();
      continue;
    }
    if (
      last.nodeType === Node.TEXT_NODE &&
      !(last.textContent ?? "").replace(/\u200b/g, "").trim()
    ) {
      last.remove();
      continue;
    }
    break;
  }
}

function createPlainBreakBlock(): HTMLDivElement {
  const block = document.createElement("div");
  block.appendChild(document.createElement("br"));
  return block;
}

function placeCaretIn(node: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const nextRange = document.createRange();
  nextRange.setStart(node, 0);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function unwrapBlockquote(quote: HTMLElement): void {
  const parent = quote.parentNode;
  if (!parent) return;
  while (quote.firstChild) {
    parent.insertBefore(quote.firstChild, quote);
  }
  quote.remove();
}

function wrapCurrentBlockInQuote(editor: HTMLElement): void {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;

  if (!anchor || !editor.contains(anchor)) {
    const quote = document.createElement("blockquote");
    while (editor.firstChild) {
      quote.appendChild(editor.firstChild);
    }
    editor.appendChild(quote);
    return;
  }

  let block: Node | null = anchor.nodeType === Node.TEXT_NODE ? anchor : anchor;
  while (block && block.parentNode && block.parentNode !== editor) {
    block = block.parentNode;
  }
  if (!block || block === editor) {
    const quote = document.createElement("blockquote");
    while (editor.firstChild) {
      quote.appendChild(editor.firstChild);
    }
    editor.appendChild(quote);
    return;
  }

  const quote = document.createElement("blockquote");
  editor.insertBefore(quote, block);
  quote.appendChild(block);
}

/**
 * Leave a blockquote when newline is requested on its empty last line.
 * Quoted text stays; caret moves into a normal block after the quote.
 */
export function tryExitComposerBlockquoteOnEmptyLine(
  editor: HTMLElement,
): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const anchor = selection.anchorNode;
  if (!anchor || !editor.contains(anchor)) return false;

  const quote = closestBlockquote(anchor, editor);
  if (!quote) return false;

  const range = selection.getRangeAt(0);
  if (!isCaretAtEndOfQuote(quote, range)) return false;
  if (!isCurrentQuoteLineEmpty(quote, range)) return false;

  trimTrailingBreaks(quote);

  const next = createPlainBreakBlock();
  quote.parentNode?.insertBefore(next, quote.nextSibling);

  if (isVisuallyEmptyQuote(quote)) {
    quote.remove();
  }

  placeCaretIn(next);
  editor.focus();
  return true;
}

/**
 * Toolbar quote toggle: wrap the current block, or unwrap if already quoting.
 */
export function toggleComposerBlockquote(editor: HTMLElement): void {
  editor.focus();
  const selection = window.getSelection();
  const existing = closestBlockquote(selection?.anchorNode ?? null, editor);
  if (existing) {
    unwrapBlockquote(existing);
    return;
  }

  try {
    document.execCommand("formatBlock", false, "blockquote");
  } catch {
    // jsdom / unsupported document
  }

  if (closestBlockquote(window.getSelection()?.anchorNode ?? null, editor)) {
    return;
  }

  wrapCurrentBlockInQuote(editor);
}
