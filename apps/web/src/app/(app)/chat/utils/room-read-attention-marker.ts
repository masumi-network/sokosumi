/**
 * Stable key for the room mark-read effect.
 *
 * Includes open-thread activity so looking a thread (or a new reply while the
 * panel is open) re-fires room mark-read. Top-level-only markers miss thread
 * replies, which still contribute to room unreadCount via thread look state.
 */
export function roomReadAttentionMarker(options: {
  roomId: string;
  latestTopLevelMessageId: string | null | undefined;
  openThreadParentId: string | null | undefined;
  latestOpenThreadMessageId: string | null | undefined;
}): string {
  const topLevel = options.latestTopLevelMessageId ?? "empty";
  const threadParent = options.openThreadParentId ?? "none";
  const threadMessage = options.latestOpenThreadMessageId ?? "none";
  return `${options.roomId}:${topLevel}:${threadParent}:${threadMessage}`;
}
