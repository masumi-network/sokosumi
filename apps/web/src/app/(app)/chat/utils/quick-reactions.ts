/** One-tap reactions for someone with no emoji history yet. */
export const DEFAULT_QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"] as const;

/**
 * Slack-style quick reactions: the reader's frequently used emojis (already
 * ranked) first, padded with defaults they are not already showing.
 */
export function resolveQuickReactions(
  frequentlyUsed: readonly string[],
  count: number,
): string[] {
  return [...new Set([...frequentlyUsed, ...DEFAULT_QUICK_REACTIONS])].slice(
    0,
    count,
  );
}
