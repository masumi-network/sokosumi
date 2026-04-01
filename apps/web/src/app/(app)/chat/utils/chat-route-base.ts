/** App Router shell for production chat (`/chat/...`). */
export const CHAT_APP_ROUTE_PREFIX = "/chat" as const;

/** App Router shell for experimental AI SDK chat (`/new-chat/...`). */
export const NEW_CHAT_APP_ROUTE_PREFIX = "/new-chat" as const;

export type ChatAppRoutePrefix =
  | typeof CHAT_APP_ROUTE_PREFIX
  | typeof NEW_CHAT_APP_ROUTE_PREFIX;

function pathMatchesPrefix(
  pathname: string,
  prefix: ChatAppRoutePrefix,
): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Session storage key for “just created” conversation flash (per shell). */
export function getPendingConversationStorageKey(
  routePrefix: ChatAppRoutePrefix,
): string {
  return routePrefix === NEW_CHAT_APP_ROUTE_PREFIX
    ? "new-chat-pending-conversation-id"
    : "chat-pending-conversation-id";
}

/** Full-page chat routes where the floating chat rail should stay hidden. */
export function isChatShellPathname(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) {
    return false;
  }
  return (
    pathMatchesPrefix(pathname, CHAT_APP_ROUTE_PREFIX) ||
    pathMatchesPrefix(pathname, NEW_CHAT_APP_ROUTE_PREFIX)
  );
}

export function getBucketSlugFromChatPathname(
  pathname: string,
  routePrefix: ChatAppRoutePrefix,
): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const prefixParts = routePrefix.split("/").filter(Boolean);
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
  routePrefix: ChatAppRoutePrefix,
): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const prefixParts = routePrefix.split("/").filter(Boolean);
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

export function getChatApiPathForRoutePrefix(
  routePrefix: ChatAppRoutePrefix,
): "/api/chat" | "/api/new-chat" {
  return routePrefix === NEW_CHAT_APP_ROUTE_PREFIX
    ? "/api/new-chat"
    : "/api/chat";
}
