/**
 * Toolbar code block toggle.
 *
 * `document.execCommand("insertHTML", …, "<pre><code></code></pre>")` leaves the
 * caret on the `pre` rather than inside the `code`, so the next keystroke lands
 * as a `pre` child *beside* the empty `code`. The block then serializes from an
 * empty `code` and the typed text is dropped. This module builds the block by
 * hand and owns the caret so the text always stays inside `code`.
 */

function closestCodeBlock(
  node: Node | null,
  editor: HTMLElement,
): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== editor) {
    if (current instanceof HTMLElement && current.tagName === "PRE") {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function isBr(node: Node | null): boolean {
  return node instanceof HTMLElement && node.tagName === "BR";
}

/** Text of a code block, with `br` read back as the newline it renders as. */
function readCodeBlockText(pre: HTMLElement): string {
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
  walk(pre);
  return out.replace(/\u200b/g, "");
}

function createCodeBlock(text: string): HTMLPreElement {
  const pre = document.createElement("pre");
  const code = document.createElement("code");

  if (text.length === 0) {
    // An empty block collapses to its padding and cannot hold the caret, so it
    // needs the same trailing break contentEditable gives every other block.
    code.appendChild(document.createElement("br"));
  } else {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) code.appendChild(document.createElement("br"));
      if (line.length > 0) code.appendChild(document.createTextNode(line));
    });
  }

  pre.appendChild(code);
  return pre;
}

function placeCaretAtStartOf(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtEndOf(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Unwrap a code block back into plain lines, preserving its newlines. */
function unwrapCodeBlock(pre: HTMLElement): void {
  const parent = pre.parentNode;
  if (!parent) return;

  const text = readCodeBlockText(pre).replace(/\n$/, "");
  const replacement = document.createDocumentFragment();
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    if (index > 0) replacement.appendChild(document.createElement("br"));
    if (line.length > 0) {
      replacement.appendChild(document.createTextNode(line));
    }
  });

  if (!replacement.firstChild) {
    replacement.appendChild(document.createElement("br"));
  }

  const last = replacement.lastChild;
  parent.replaceChild(replacement, pre);
  if (!last) return;

  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (last.nodeType === Node.TEXT_NODE) {
    range.setStart(last, (last.textContent ?? "").length);
  } else {
    range.setStartAfter(last);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Toolbar code block toggle: wrap the selection (or open an empty block), or
 * unwrap when the caret already sits in one.
 */
export function toggleComposerCodeBlock(editor: HTMLElement): void {
  editor.focus();
  const selection = window.getSelection();

  const existing = closestCodeBlock(selection?.anchorNode ?? null, editor);
  if (existing) {
    unwrapCodeBlock(existing);
    editor.focus();
    return;
  }

  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  if (!range || !editor.contains(range.commonAncestorContainer)) {
    const pre = createCodeBlock("");
    editor.appendChild(pre);
    const code = pre.querySelector("code");
    if (code) placeCaretAtStartOf(code);
    editor.focus();
    return;
  }

  const selectedText = range.collapsed ? "" : range.toString();
  const pre = createCodeBlock(selectedText);

  range.deleteContents();
  range.insertNode(pre);

  const code = pre.querySelector("code");
  if (code) {
    if (selectedText.length > 0) {
      placeCaretAtEndOf(code);
    } else {
      placeCaretAtStartOf(code);
    }
  }
  editor.focus();
}
