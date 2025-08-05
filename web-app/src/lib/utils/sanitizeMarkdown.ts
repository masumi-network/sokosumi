// lib/sanitizeMarkdown.ts
import DOMPurify from "isomorphic-dompurify";

export function sanitizeMarkdown(markdown: string): string {
  return DOMPurify.sanitize(markdown, {
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
    ],
  });
}
