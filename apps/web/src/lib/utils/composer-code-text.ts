/**
 * Read a code block as the text it renders.
 *
 * Shared by the markdown serializer and the toolbar toggle, which have to agree
 * on what a block contains: if they disagree, toggling a block off rewrites the
 * text the composer would have sent.
 */

// Tags contentEditable uses to split a code block into lines.
const CODE_BLOCK_LINE_TAGS = new Set(["DIV", "P"]);

/**
 * Text of a code container, with `br` and block children read back as the
 * newlines they draw.
 *
 * Reads the whole container rather than a `code` child: contentEditable parks
 * typed text as a `pre` child *beside* the `code` when the caret sits on the
 * `pre`, and that text is part of the block the author sees.
 *
 * A trailing newline is dropped only when it comes from structure — a `br` or a
 * block close — because contentEditable keeps one in every block so it stays
 * focusable. A trailing newline that comes from text is the author's own blank
 * last line and survives.
 */
export function readComposerCodeText(container: HTMLElement): string {
  let text = "";
  let endedWithStructuralBreak = false;

  const startLine = (): void => {
    if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? "").replace(/\u200b/g, "");
      if (value.length > 0) {
        text += value;
        endedWithStructuralBreak = false;
      }
      return;
    }

    if (!(node instanceof HTMLElement)) {
      node.childNodes.forEach(walk);
      return;
    }

    if (node.tagName === "BR") {
      text += "\n";
      endedWithStructuralBreak = true;
      return;
    }

    if (!CODE_BLOCK_LINE_TAGS.has(node.tagName)) {
      node.childNodes.forEach(walk);
      return;
    }

    startLine();
    node.childNodes.forEach(walk);
    startLine();
    endedWithStructuralBreak = true;
  };

  walk(container);

  const normalized = text.replace(/\r/g, "");
  return endedWithStructuralBreak ? normalized.replace(/\n$/, "") : normalized;
}
