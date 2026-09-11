import { createHighlighter } from "@tanstack/highlight/core";
import { css } from "@tanstack/highlight/languages/css";
import { html } from "@tanstack/highlight/languages/html";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { jsx } from "@tanstack/highlight/languages/jsx";
import { markdown } from "@tanstack/highlight/languages/markdown";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { python } from "@tanstack/highlight/languages/python";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { rehypePreCodeToHast } from "@tanstack/highlight/rehype";

export const markdownHighlighter = createHighlighter({
  fallbackLanguage: "plaintext",
  languages: [
    plaintext,
    ts,
    tsx,
    jsx,
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

const highlightOptions = { highlighter: markdownHighlighter };

interface HastLikeNode {
  children?: HastLikeNode[];
  tagName?: string;
  type?: string;
}

export function rehypeMarkdownCodeHighlight() {
  return (tree: HastLikeNode) => {
    highlightFencedCodeBlocks(tree);
  };
}

function highlightFencedCodeBlocks(node: HastLikeNode) {
  const children = node.children;
  if (!children) {
    return;
  }

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child.type === "element" && child.tagName === "pre") {
      try {
        const highlighted = rehypePreCodeToHast(
          child as Parameters<typeof rehypePreCodeToHast>[0],
          highlightOptions,
        );
        if (highlighted) {
          children[index] = highlighted;
        }
      } catch {
        // Official adapter walks every `pre` without isolation. highlight()
        // already keeps incomplete streams as plaintext; this catch is for
        // unexpected tokenizer/HAST throws so later fences still highlight.
      }
      continue;
    }
    highlightFencedCodeBlocks(child);
  }
}
