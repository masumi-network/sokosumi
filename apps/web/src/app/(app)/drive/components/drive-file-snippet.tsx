"use client";

import type { FileResource } from "@sokosumi/core-client";

/** The snippet shape as the generated client inlines it on a resource. */
type FileSnippet = NonNullable<FileResource["snippet"]>;

/**
 * Render an extracted snippet with its highlights.
 *
 * The API returns plain text plus offsets rather than markup, so this
 * renders React text nodes and never `dangerouslySetInnerHTML`. Document
 * content cannot become markup on the way to the screen.
 */
export function DriveFileSnippet({ snippet }: { snippet: FileSnippet }) {
  const parts: { text: string; highlighted: boolean }[] = [];
  let cursor = 0;

  for (const highlight of snippet.highlights) {
    if (highlight.start > cursor) {
      parts.push({
        text: snippet.text.slice(cursor, highlight.start),
        highlighted: false,
      });
    }
    parts.push({
      text: snippet.text.slice(highlight.start, highlight.end),
      highlighted: true,
    });
    cursor = highlight.end;
  }
  if (cursor < snippet.text.length) {
    parts.push({ text: snippet.text.slice(cursor), highlighted: false });
  }

  return (
    <span className="text-muted-foreground line-clamp-2 text-xs">
      {snippet.truncatedStart ? "… " : null}
      {parts.map((part, index) =>
        part.highlighted ? (
          <mark
            // Offsets are stable within one snippet, and the text can repeat.
            key={`${index}-${part.text}`}
            className="bg-transparent font-medium text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${index}-${part.text}`}>{part.text}</span>
        ),
      )}
      {snippet.truncatedEnd ? " …" : null}
    </span>
  );
}
