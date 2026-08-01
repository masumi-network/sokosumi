/**
 * Inline `<code>` toggle for the WYSIWYG composer.
 * Empty caret enters/exits code typing mode without inserting a placeholder word.
 */

export const COMPOSER_CODE_CARET_MARK = "\u200b";

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function findInlineCodeAncestor(
  node: Node | null,
  editor: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);

  while (current && current !== editor) {
    if (
      current.tagName === "CODE" &&
      current.closest("pre") === null &&
      editor.contains(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
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

function placeCaretInCode(code: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  if (!code.firstChild) {
    code.appendChild(document.createTextNode(COMPOSER_CODE_CARET_MARK));
  }

  const textNode = code.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    const range = document.createRange();
    range.selectNodeContents(code);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  const offset = Math.min(
    textNode.textContent?.length ?? 0,
    Math.max(1, textNode.textContent?.length ?? 0),
  );
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertHtmlAtSelection(html: string): void {
  try {
    document.execCommand("insertHTML", false, html);
  } catch {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) placeCaretAfter(last);
  }
}

/**
 * Toggle inline code at the current selection inside `editor`.
 * - Selection with text: wrap in `<code>`
 * - Multiline selection: wrap in `<pre><code>`
 * - Collapsed inside inline code: exit (caret after; drop empty shells)
 * - Collapsed outside: enter empty `<code>` shell for next typing
 */
export function toggleComposerInlineCode(editor: HTMLElement): void {
  editor.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const text = selection.toString();
  if (text.includes("\n")) {
    insertHtmlAtSelection(`<pre><code>${escapeHtmlText(text)}</code></pre>`);
    return;
  }

  if (text.length > 0) {
    insertHtmlAtSelection(`<code>${escapeHtmlText(text)}</code>`);
    return;
  }

  const codeAncestor = findInlineCodeAncestor(selection.anchorNode, editor);
  if (codeAncestor) {
    placeCaretAfter(codeAncestor);
    const visible = (codeAncestor.textContent ?? "").replace(
      new RegExp(COMPOSER_CODE_CARET_MARK, "g"),
      "",
    );
    if (visible.length === 0) {
      codeAncestor.remove();
    }
    return;
  }

  const code = document.createElement("code");
  code.appendChild(document.createTextNode(COMPOSER_CODE_CARET_MARK));
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(code);
  placeCaretInCode(code);
}
