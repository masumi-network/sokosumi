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

/** Mobile chrome surface for pathname-driven shell/header behavior. */
export type ChatChromeSurface = "home" | "room" | "other-chat";

const CHAT_ROOM_PATHNAME_RE = /^\/chat\/rooms\/[^/]+/;

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

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

/** True for `/chat/rooms/:roomId` (and nested room paths). */
export function isChatRoomPathname(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) {
    return false;
  }
  return CHAT_ROOM_PATHNAME_RE.test(pathname);
}

function readSearchParam(
  searchParams: SearchParamsLike,
  key: string,
): string | null {
  if (!searchParams) {
    return null;
  }
  if (typeof searchParams.get === "function") {
    return searchParams.get(key);
  }
  return null;
}

/**
 * Classifies chat mobile chrome by pathname (+ optional search).
 * Callers outside chat still get `"other-chat"` (safe default).
 */
export function classifyChatChromeSurface(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): ChatChromeSurface {
  if (isChatRoomPathname(pathname)) {
    return "room";
  }

  if (pathname === CHAT_APP_ROUTE_PREFIX) {
    const create = readSearchParam(searchParams, "create");
    const dm = readSearchParam(searchParams, "dm");
    if (create === "channel" || dm === "new") {
      return "other-chat";
    }
    return "home";
  }

  return "other-chat";
}
