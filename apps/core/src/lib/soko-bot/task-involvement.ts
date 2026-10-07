/**
 * Delegations that make a bot part of a Task: it created, assigned, edited or
 * works it. A comment alone does not. When it did, every bot that ever replied
 * on a Task followed it for a month, woke on each later comment (other bots'
 * included), nudged it when it stalled, and answered the others.
 */
export const INVOLVING_DELEGATION = {
  action: { not: "reply_to_task" },
} as const;

/** The bot's name as a whole word, case-insensitive; an unnamed bot is never named. */
export function commentNamesBot(
  comment: string,
  botName: string | null,
): boolean {
  const name = botName?.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(comment);
}
