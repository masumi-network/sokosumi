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

/**
 * Room id from the optimistic sidebar selection (`useRoomSelection`).
 *
 * The highlight follows this on click, before `usePathname` commits. Dim
 * follows it too, or a read room stays faded under the bar until the route
 * catches up. The path is `/chat/rooms/<id>` plus an optional query. A path
 * that continues past the room, or is not a room, means no room is open.
 */
export function getActiveRoomIdFromSelection(
  selectedPath: string,
): string | null {
  const path = selectedPath.split("?")[0];
  const id = path.startsWith("/chat/rooms/")
    ? path.slice("/chat/rooms/".length)
    : "";
  return id && !id.includes("/") ? id : null;
}
