/** Soft cap for room message quote preview text (composer chip + persisted snapshot). */
export const QUOTE_SNIPPET_MAX_CHARS = 280;

/**
 * Light plain-text preview for a quoted room message. Strips cheap markdown
 * markers and collapses whitespace for attribution snippets.
 */
export function buildQuoteSnippet(content: string): string {
  const flattened = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (flattened.length > QUOTE_SNIPPET_MAX_CHARS) {
    return `${flattened.slice(0, QUOTE_SNIPPET_MAX_CHARS)}…`;
  }
  return flattened;
}
