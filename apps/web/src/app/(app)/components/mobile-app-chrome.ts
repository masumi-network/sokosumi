import {
  classifyChatChromeSurface,
  isChatRoomPathname,
  isChatShellPathname,
} from "@/app/chat/utils/chat-route-base";

/**
 * Bottom-nav tab list roots: exact matches get the mobile tab bar; nested
 * paths get a back control to the list root (no back at the root itself).
 */
const MOBILE_TAB_LIST_PATHS = [
  "/tasks",
  "/agents",
  "/projects",
  "/history",
] as const;

/**
 * Non-tab hub list roots (PA / admin / notifications): tab bar at root;
 * root back → Chats; nested → list root.
 */
const MOBILE_NON_TAB_HUB_LIST_PATHS = [
  "/personal-assistant",
  "/admin",
  "/notifications",
] as const;

const MAIN_APP_MOBILE_LIST_PATHS = [
  ...MOBILE_TAB_LIST_PATHS,
  ...MOBILE_NON_TAB_HUB_LIST_PATHS,
] as const;

type MainAppMobileListPath = (typeof MAIN_APP_MOBILE_LIST_PATHS)[number];

const MAIN_APP_MOBILE_LIST_PATH_SET = new Set<string>(
  MAIN_APP_MOBILE_LIST_PATHS,
);

const MOBILE_TAB_LIST_PATH_SET = new Set<string>(MOBILE_TAB_LIST_PATHS);

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

export type MobileAppBackLabelKey = "backToChats" | "back";

export interface MobileAppBackTarget {
  href: string;
  labelKey: MobileAppBackLabelKey;
}

/** True for exact main list routes that show the mobile bottom tab bar. */
export function isMainAppMobileChromePathname(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) {
    return false;
  }
  return MAIN_APP_MOBILE_LIST_PATH_SET.has(pathname);
}

function findMainAppListRoot(pathname: string): MainAppMobileListPath | null {
  for (const root of MAIN_APP_MOBILE_LIST_PATHS) {
    if (pathname === root || pathname.startsWith(`${root}/`)) {
      return root;
    }
  }
  return null;
}

/**
 * Back target for main list routes and their nested pages.
 * Tab list roots → null; non-tab hub roots → Chats; nested → list root.
 */
export function resolveMobileAppBackTarget(
  pathname: string | null | undefined,
): MobileAppBackTarget | null {
  if (!pathname) {
    return null;
  }
  const root = findMainAppListRoot(pathname);
  if (!root) {
    return null;
  }
  if (pathname === root) {
    if (MOBILE_TAB_LIST_PATH_SET.has(root)) {
      return null;
    }
    return { href: "/chat/chats", labelKey: "backToChats" };
  }
  return { href: root, labelKey: "back" };
}

/**
 * Fixed tab bar: chat shell (except rooms/drafts) + main list routes.
 * Drafts (`?dm=new`, `?create=channel`, `?welcome=1`) share `/chat`
 * but hide the tab bar like rooms.
 */
export function shouldShowMobileBottomNav(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): boolean {
  if (!pathname) {
    return false;
  }
  if (isChatRoomPathname(pathname)) {
    return false;
  }
  if (classifyChatChromeSurface(pathname, searchParams) === "draft") {
    return false;
  }
  if (isChatShellPathname(pathname)) {
    return true;
  }
  return isMainAppMobileChromePathname(pathname);
}

/**
 * Leading slot shows Sokosumi brand on Chats list and every bottom-nav tab
 * root (Tasks / Agents / Projects / Search). Nested pages keep back.
 */
export function shouldShowMobileBrandLeading(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): boolean {
  const surface = classifyChatChromeSurface(pathname, searchParams);
  if (surface === "home" || surface === "chats") {
    return true;
  }
  if (!pathname) {
    return false;
  }
  return MOBILE_TAB_LIST_PATH_SET.has(pathname);
}

/** Floating create FAB: Chats list only (not drafts / welcome / bare home). */
export function shouldShowMobileCreateFab(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): boolean {
  const surface = classifyChatChromeSurface(pathname, searchParams);
  return surface === "chats";
}
