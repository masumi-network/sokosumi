/** App Router shell for full-page chat (`/chat/...`). */
export const CHAT_APP_ROUTE_PREFIX = "/chat" as const;

/**
 * Next.js BFF for room-keyed Core chat stream APIs.
 *
 * - `GET ${CHAT_API_PATH}?roomId=…` → Core `/v1/chats/rooms/{roomId}/stream/messages`
 * - `POST ${CHAT_API_PATH}` with `{ roomId, … }` → Core `/v1/chats/rooms/{roomId}/stream`
 * - `GET ${CHAT_API_PATH}/{roomId}/stream` → Core `/v1/chats/rooms/{roomId}/stream/active`
 */
export const CHAT_API_PATH = "/api/chat" as const;

function pathMatchesChatPrefix(pathname: string): boolean {
  return (
    pathname === CHAT_APP_ROUTE_PREFIX ||
    pathname.startsWith(`${CHAT_APP_ROUTE_PREFIX}/`)
  );
}

/** True for full-page `/chat` shell routes (and nested paths). */
export function isChatShellPathname(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) {
    return false;
  }
  return pathMatchesChatPrefix(pathname);
}
