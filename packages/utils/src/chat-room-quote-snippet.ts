/**
 * Plain-text quote body for a quoted room message. Strips cheap markdown
 * markers and collapses horizontal whitespace while preserving newlines.
 * Mention tokens stay intact; the render layer formats them for display.
 * Returns the full cleaned message (no character truncation).
 */
export function buildQuoteSnippet(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]+/g, "")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}
