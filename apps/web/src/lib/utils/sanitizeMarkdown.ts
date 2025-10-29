import sanitizeHtml from "sanitize-html";

// Handles markdown replacements for custom rules
export function handleMarkdownReplaces(markdown: string): string {
  // Replace lines containing only three or more dashes, asterisks, or underscores (with optional spaces) with '___'
  return markdown.replace(/^( {0,3}(([-*_])\s?){3,})$/gm, "\n___\n");
}

export function sanitizeMarkdown(markdown: string): string {
  const replacedMarkdown = handleMarkdownReplaces(markdown);
  return sanitizeHtml(replacedMarkdown, {
    allowedTags: [
      "b",
      "i",
      "em",
      "strong",
      "a",
      "source",
      "p",
      "h1",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "br",
      "img",
      "video",
      "code",
      "mark",
      "span",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt", "title", "width", "height"],
      video: [
        "src",
        "controls",
        "autoplay",
        "loop",
        "muted",
        "width",
        "height",
      ],
      source: ["src"],
      "*": ["class"],
    },
  });
}
