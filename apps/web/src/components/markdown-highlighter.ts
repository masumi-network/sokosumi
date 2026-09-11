import { createHighlighter } from "@tanstack/highlight/core";
import { css } from "@tanstack/highlight/languages/css";
import { html } from "@tanstack/highlight/languages/html";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { markdown } from "@tanstack/highlight/languages/markdown";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { python } from "@tanstack/highlight/languages/python";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { rehypeHighlightCodeBlocks } from "@tanstack/highlight/rehype";

export const markdownHighlighter = createHighlighter({
  fallbackLanguage: "plaintext",
  languages: [
    plaintext,
    ts,
    tsx,
    js,
    json,
    shell,
    python,
    sql,
    css,
    html,
    markdown,
  ],
});

const highlightMarkdownCodeBlocks = rehypeHighlightCodeBlocks({
  highlighter: markdownHighlighter,
});

export function rehypeMarkdownCodeHighlight() {
  return (tree: unknown) => {
    try {
      highlightMarkdownCodeBlocks(
        tree as Parameters<typeof highlightMarkdownCodeBlocks>[0],
      );
    } catch {
      // Incomplete streamed fences stay as escaped plaintext code.
    }
  };
}
