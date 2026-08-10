/**
 * Drop a membership-visible room after the current user loses membership
 * (SOK-746). Mirrors voluntary leave: soft-remove from the room list, then
 * leave the room view when that room was selected — silent, no toast.
 */
export interface ApplyChatMembershipRevokedUiOptions {
  roomId: string;
  /** Room id from `/chat/rooms/[roomId]` when a room is open; else null. */
  activeRoomId: string | null;
  replace: (href: string) => void;
  refresh: () => void;
  notifyRemoved: (roomId: string) => void;
}

export function applyChatMembershipRevokedUi(
  options: ApplyChatMembershipRevokedUiOptions,
): void {
  const { roomId, activeRoomId, replace, refresh, notifyRemoved } = options;

  notifyRemoved(roomId);

  if (activeRoomId === roomId) {
    replace("/chat");
    refresh();
  }
}
