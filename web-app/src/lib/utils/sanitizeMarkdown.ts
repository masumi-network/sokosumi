import DOMPurify from "isomorphic-dompurify";

// Handles markdown replacements for custom rules
export function handleMarkdownReplaces(markdown: string): string {
  // Replace lines containing only three or more dashes, asterisks, or underscores (with optional spaces) with '___'
  return markdown.replace(/^( {0,3}(([-*_])\s?){3,})$/gm, "\n___\n");
}

export function sanitizeMarkdown(markdown: string): string {
  const replacedMarkdown = handleMarkdownReplaces(markdown);
  return DOMPurify.sanitize(replacedMarkdown, {
    ALLOWED_TAGS: [
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
    ALLOWED_ATTR: [
      "href",
      "src",
      "controls",
      "autoplay",
      "loop",
      "muted",
      "width",
      "height",
      "allow",
      "allowfullscreen",
      "frameborder",
      "alt",
      "title",
      "class",
    ],
  });
}
