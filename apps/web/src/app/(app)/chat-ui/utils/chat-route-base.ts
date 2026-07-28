/** App Router shell for full-page chat (`/chat/...`). */
export const CHAT_APP_ROUTE_PREFIX = "/chat" as const;

/** URL segment when conversation metadata has no slugifiable coworker or model. */
export const FALLBACK_BUCKET_SEGMENT = "_" as const;

/**
 * Next.js BFF for room-keyed Core chat stream APIs.
 *
 * - `GET ${CHAT_API_PATH}?roomId=…` → Core `/v1/chats/rooms/{roomId}/stream/messages`
 * - `POST ${CHAT_API_PATH}` with `{ roomId, … }` → Core `/v1/chats/rooms/{roomId}/stream`
 * - `GET ${CHAT_API_PATH}/{roomId}/stream` → Core `/v1/chats/rooms/{roomId}/stream/active`
 */
export const CHAT_API_PATH = "/api/chat" as const;

const PENDING_CONVERSATION_STORAGE_KEY = "chat-pending-conversation-id";

function pathMatchesChatPrefix(pathname: string): boolean {
  return (
    pathname === CHAT_APP_ROUTE_PREFIX ||
    pathname.startsWith(`${CHAT_APP_ROUTE_PREFIX}/`)
  );
}

/** Session storage key for “just created” conversation flash. */
export function getPendingConversationStorageKey(): string {
  return PENDING_CONVERSATION_STORAGE_KEY;
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

export function getBucketSlugFromChatPathname(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const prefixParts = CHAT_APP_ROUTE_PREFIX.split("/").filter(Boolean);
  if (segments.length < prefixParts.length + 1) {
    return null;
  }
  for (let i = 0; i < prefixParts.length; i++) {
    if (segments[i] !== prefixParts[i]) {
      return null;
    }
  }
  return segments[prefixParts.length] ?? null;
}

export function getConversationIdFromChatPathname(
  pathname: string,
): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const prefixParts = CHAT_APP_ROUTE_PREFIX.split("/").filter(Boolean);
  const need = prefixParts.length + 3;
  if (segments.length < need) {
    return null;
  }
  for (let i = 0; i < prefixParts.length; i++) {
    if (segments[i] !== prefixParts[i]) {
      return null;
    }
  }
  const b = prefixParts.length;
  if (segments[b + 1] !== "conversation" || !segments[b + 2]) {
    return null;
  }
  return segments[b + 2] ?? null;
}
