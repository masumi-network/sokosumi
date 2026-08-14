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

/** Mobile Chats list route (mounted at bare `/chat`). */
export const CHAT_CHATS_LIST_PATH = CHAT_APP_ROUTE_PREFIX;

/** Legacy list path — always redirects to {@link CHAT_CHATS_LIST_PATH}. */
export const CHAT_CHATS_LEGACY_PATH = `${CHAT_APP_ROUTE_PREFIX}/chats` as const;

/** Welcome home (drafts/notices land here). */
export const CHAT_WELCOME_PATH = "/" as const;

/** Mobile chrome surface for pathname-driven shell/header behavior. */
export type ChatChromeSurface =
  | "home"
  | "chats"
  | "room"
  | "draft"
  | "other-chat";

const CHAT_ROOM_PATHNAME_RE = /^\/chat\/rooms\/[^/]+/;

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

export type NextSearchParamsRecord = Record<
  string,
  string | string[] | undefined
>;

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

/** True for the mobile Chats list route (bare `/chat`). */
export function isChatChatsPathname(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) {
    return false;
  }
  return pathname === CHAT_CHATS_LIST_PATH;
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

function isWelcomeHomePathname(pathname: string | null | undefined): boolean {
  return pathname === CHAT_WELCOME_PATH;
}

function isDraftComposeQuery(searchParams: SearchParamsLike): boolean {
  const create = readSearchParam(searchParams, "create");
  const dm = readSearchParam(searchParams, "dm");
  return create === "channel" || dm === "new";
}

/**
 * Draft compose or soft-land notice query — wins over the mobile list and
 * must land on Welcome (`/`).
 */
export function hasChatDraftOrNoticeQuery(
  searchParams: SearchParamsLike,
): boolean {
  if (isDraftComposeQuery(searchParams)) {
    return true;
  }
  return readSearchParam(searchParams, "notice") != null;
}

/** Build `URLSearchParams` from a Next.js `searchParams` record. */
export function toURLSearchParamsFromRecord(
  params: NextSearchParamsRecord,
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        qs.append(key, entry);
      }
    } else {
      qs.set(key, value);
    }
  }
  return qs;
}

/** `pathname` or `pathname?query` (empty query omitted). */
export function pathWithSearch(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const search = searchParams.toString();
  return search.length > 0 ? `${pathname}?${search}` : pathname;
}

/** True when a Next.js searchParams record carries draft/notice keys. */
export function hasChatDraftOrNoticeFromRecord(
  params: NextSearchParamsRecord,
): boolean {
  return hasChatDraftOrNoticeQuery(toURLSearchParamsFromRecord(params));
}

/**
 * Classifies chat mobile chrome by pathname (+ optional search).
 * Welcome home is `/`. Bare `/chat` is the mobile chats list. Callers
 * outside chat still get `"other-chat"` (safe default for hamburger).
 * Do not treat `/` as a chat shell path — use `isChatShellPathname` for that.
 */
export function classifyChatChromeSurface(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): ChatChromeSurface {
  if (isChatRoomPathname(pathname)) {
    return "room";
  }

  if (isChatChatsPathname(pathname)) {
    // Draft/notice normally server-redirect to Welcome; classify as draft if
    // the query is still present (soft-nav / tests).
    if (isDraftComposeQuery(searchParams)) {
      return "draft";
    }
    return "chats";
  }

  if (isWelcomeHomePathname(pathname)) {
    // Compose flows share Welcome but use room-style chrome (no tab bar, back).
    if (isDraftComposeQuery(searchParams)) {
      return "draft";
    }
    return "home";
  }

  return "other-chat";
}
