import { buildChatMessagePreview } from "@sokosumi/utils";

/**
 * Build a scannable plain-text label for an unread-thread row.
 *
 * The rule lives in `@sokosumi/utils` because Core builds the same preview for
 * an OS banner, and a message that reads one way in a thread row and another
 * way on a lock screen is two answers to one message.
 *
 * `mentionNames` names the members of the room by the id a mention token
 * carries. Core reads the same names from the database for a banner; here the
 * room already has its roster in hand.
 */
export function formatUnreadThreadsPreview(
  content: string,
  mentionNames?: ReadonlyMap<string, string>,
): string {
  return buildChatMessagePreview(content, mentionNames);
}
