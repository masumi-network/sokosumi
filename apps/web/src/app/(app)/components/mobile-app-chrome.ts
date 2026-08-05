import {
  classifyChatChromeSurface,
  isChatRoomPathname,
  isChatShellPathname,
} from "@/app/chat/utils/chat-route-base";

/**
 * Top-level Home-hub destinations (sidebar leaf list routes).
 * Exact matches get the mobile tab bar; nested paths get a back control.
 */
const MAIN_APP_MOBILE_LIST_PATHS = [
  "/tasks",
  "/projects",
  "/agents",
  "/history",
  "/personal-assistant",
  "/admin",
  "/notifications",
] as const;

type MainAppMobileListPath = (typeof MAIN_APP_MOBILE_LIST_PATHS)[number];

const MAIN_APP_MOBILE_LIST_PATH_SET = new Set<string>(
  MAIN_APP_MOBILE_LIST_PATHS,
);

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

export type MobileAppBackLabelKey = "backToHome" | "back";

export interface MobileAppBackTarget {
  href: string;
  labelKey: MobileAppBackLabelKey;
}

/** True for exact main list routes opened from the mobile Home hub. */
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
 * Back target for main hub list routes and their nested pages.
 * List roots → Home (`/chat`); nested → their list root.
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
    return { href: "/chat", labelKey: "backToHome" };
  }
  return { href: root, labelKey: "back" };
}

/**
 * Fixed Home/Chats/Search tab bar: chat shell (except rooms) + main hub list routes.
 */
export function shouldShowMobileBottomNav(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) {
    return false;
  }
  if (isChatRoomPathname(pathname)) {
    return false;
  }
  if (isChatShellPathname(pathname)) {
    return true;
  }
  return isMainAppMobileChromePathname(pathname);
}

/**
 * Leading slot shows Sokosumi brand only on Home hub and Chats list.
 */
export function shouldShowMobileBrandLeading(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): boolean {
  const surface = classifyChatChromeSurface(pathname, searchParams);
  return surface === "home" || surface === "chats";
}
