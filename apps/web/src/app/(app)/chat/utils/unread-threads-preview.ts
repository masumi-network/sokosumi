import { buildChatMessagePreview } from "@sokosumi/utils";

/**
 * Build a scannable plain-text label for an unread-thread row.
 *
 * The rule lives in `@sokosumi/utils` because Core builds the same preview for
 * an OS banner, and a message that reads one way in a thread row and another
 * way on a lock screen is two answers to one message.
 */
export function formatUnreadThreadsPreview(content: string): string {
  return buildChatMessagePreview(content);
}
