/**
 * Tags whose html→markdown serializer emits a trailing newline (or a fenced
 * code block). When these follow bare text — Chrome contentEditable's first
 * line pattern — prepend `\n` so the first break is not glued away.
 *
 * Keep in sync with `processNode` cases in `composer-markdown-dom.ts` that append
 * `\n` (`div`/`p`/`blockquote`/headings/lists/`pre`/fenced `code`).
 */
export function isBlockMarkdownElement(
  childTag: string,
  childMarkdown: string,
): boolean {
  return (
    childTag === "pre" ||
    childTag === "div" ||
    childTag === "p" ||
    childTag === "blockquote" ||
    childTag === "h1" ||
    childTag === "h2" ||
    childTag === "h3" ||
    childTag === "ul" ||
    childTag === "ol" ||
    childTag === "li" ||
    (childTag === "code" && childMarkdown.startsWith("```"))
  );
}

export function getBacktickFence(text: string): string {
  const matches = text.match(/`+/g);
  const maxRun = matches
    ? matches.reduce((max, match) => Math.max(max, match.length), 0)
    : 0;
  const fenceLength = Math.max(3, maxRun + 1);
  return "`".repeat(fenceLength);
}

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith("mailto:")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_error) {
    return null;
  }

  return null;
}

export function isMarkdownEditorDomEmpty(editor: HTMLElement): boolean {
  const html = editor.innerHTML;
  return (
    html === "" ||
    html === "<br>" ||
    html === "<div><br></div>" ||
    html === "<p><br></p>" ||
    (editor.textContent ?? "").replace(/\u200b/g, "").trim() === ""
  );
}

export function syncMarkdownEditorEmptyState(editor: HTMLElement): void {
  if (isMarkdownEditorDomEmpty(editor)) {
    editor.setAttribute("data-empty", "");
  } else {
    editor.removeAttribute("data-empty");
  }
}
