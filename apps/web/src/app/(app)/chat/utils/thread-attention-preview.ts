import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

/** Persist mention token `@key:slug` (key is uuid, `all`, etc.). */
const MENTION_TOKEN_REGEX = /@([^\s:]+):([^\s]+)/g;

/**
 * Build a scannable plain-text label for an unread-thread row.
 * Strips markdown and collapses `@id:slug` mention tokens to `@slug`.
 */
export function formatThreadAttentionPreview(content: string): string {
  const withReadableMentions = content.replace(
    MENTION_TOKEN_REGEX,
    (_match, _key: string, slug: string) => `@${slug}`,
  );
  const plain = stripMarkdownToText(withReadableMentions) ?? "";
  return plain.replace(/\s+/g, " ").trim();
}
