const DEFAULT_CODE_TEXT = "code";
const DEFAULT_LINK_TEXT = "link";
const DEFAULT_HEADING_TEXT = "Heading";

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

function getNormalizedSelection(
  selectionText: string,
  fallbackText: string,
): string {
  const trimmed = selectionText.trim();
  if (!trimmed) return fallbackText;
  return selectionText;
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

export function formatInlineCodeSnippet(selectionText: string): string {
  const text = getNormalizedSelection(selectionText, DEFAULT_CODE_TEXT);
  if (text.includes("\n") || text.includes("`")) {
    const fence = getBacktickFence(text);
    return `${fence}\n${text}\n${fence}`;
  }

  return `\`${text}\``;
}

export function formatMarkdownLink(
  selectionText: string,
  url: string,
): string | null {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  const text = selectionText.trim() || DEFAULT_LINK_TEXT;
  // Escape backslashes first so they can't merge with the following escape
  // and break out of the link/text (js/incomplete-sanitization).
  const escapedText = text.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  const escapedUrl = normalizedUrl.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
  return `[${escapedText}](${escapedUrl})`;
}

export function formatHeading(selectionText: string): string {
  const text = selectionText.trim() || DEFAULT_HEADING_TEXT;
  return `\n## ${text}\n`;
}
