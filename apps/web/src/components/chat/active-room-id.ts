/**
 * The room the reader currently has open, read from the pathname.
 *
 * Chat room routes are `/chat/rooms/<roomId>`; every other path means no room
 * is open. Sidebar attention chrome is suppressed on the active room, so a
 * wrong answer here shows unread on a room the reader is looking at.
 */
export function getActiveRoomIdFromPathname(
  pathname: string | null,
): string | null {
  if (!pathname?.startsWith("/chat/rooms/")) {
    return null;
  }

  const roomId = pathname.split("/")[3];
  return roomId || null;
}
