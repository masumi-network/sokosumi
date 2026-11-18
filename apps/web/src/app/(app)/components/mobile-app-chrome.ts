import {
  campaignsHref,
  RANGE_PARAMS,
  type RangeParam,
} from "@/app/ads/ads-query";
import {
  CHAT_CHATS_LIST_PATH,
  classifyChatChromeSurface,
  isChatRoomPathname,
  isChatShellPathname,
} from "@/app/chat/utils/chat-route-base";
import {
  PROJECT_SCOPE_PARAM,
  scopedHref,
} from "@/app/components/project-scope/project-scope-href";

/** Exact paths that show the mobile tab bar. */
const MOBILE_TAB_LIST_PATHS = [
  "/tasks",
  "/agents",
  "/drive",
  "/calendar",
  "/schedules",
  "/contacts",
  "/social",
  "/newsletter",
  "/newsletter/issues",
  "/newsletter/subscribers",
  "/newsletter/signup-form",
  "/newsletter/analytics",
  "/newsletter/settings",
  "/studio",
  "/tiktok-studio",
  "/projects",
  "/you",
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

/** You page rows that live outside `/you/`; back returns to You. */
const YOU_HUB_CHILD_PATHS = [
  "/account",
  "/billing",
  "/connections",
  "/seo",
  "/ads",
] as const;

/**
 * You page rows that are tab list roots. Opened from You (`withYouEntry`
 * marks the link), they light the You tab and go back to You; opened from
 * anywhere else they keep their own chrome.
 */
export const YOU_ROW_LIST_PATHS = new Set<string>([
  "/history",
  "/agents",
  "/schedules",
  "/calendar",
  "/studio",
  "/tiktok-studio",
  "/social",
  "/contacts",
  "/drive",
]);

/**
 * Marks a You row link with `from=you`, keeping its other params. The marker
 * lives on that history entry, so reload, Back and Forward keep it, a new tab
 * from a modified click gets it, and the same page reached any other way
 * does not.
 */
const YOU_ENTRY_PARAM = "from";
const YOU_ENTRY_VALUE = "you";

export function withYouEntry(href: string): string {
  const [path = href, query = ""] = href.split("?");
  if (!YOU_ROW_LIST_PATHS.has(path)) {
    return href;
  }
  const params = new URLSearchParams(query);
  params.set(YOU_ENTRY_PARAM, YOU_ENTRY_VALUE);
  return `${path}?${params.toString()}`;
}

/** A You row list root the reader opened from the You page. */
export function isOpenedYouRow(
  pathname: string,
  searchParams: SearchParamsLike,
): boolean {
  return (
    YOU_ROW_LIST_PATHS.has(pathname) &&
    searchParams?.get?.(YOU_ENTRY_PARAM) === YOU_ENTRY_VALUE
  );
}

const BACK_TO_YOU: MobileAppBackTarget = {
  href: "/you",
  labelKey: "backToYou",
};

const DEVELOPER_PATH = /^\/developer(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/;

const AGENT_JOBS_PATH = /^\/agents\/([^/]+)\/jobs(?:\/|$)/;

type MainAppMobileListPath = (typeof MAIN_APP_MOBILE_LIST_PATHS)[number];

const MOBILE_TAB_LIST_PATH_SET = new Set<string>(MOBILE_TAB_LIST_PATHS);

const MOBILE_NON_TAB_HUB_LIST_PATH_SET = new Set<string>(
  MOBILE_NON_TAB_HUB_LIST_PATHS,
);

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

export type MobileAppBackLabelKey =
  | "backToChats"
  | "back"
  | "goHome"
  | "backToYou";

export interface MobileAppBackTarget {
  href: string;
  labelKey: MobileAppBackLabelKey;
}

function findMainAppListRoot(pathname: string): MainAppMobileListPath | null {
  for (const root of MAIN_APP_MOBILE_LIST_PATHS) {
    if (pathname === root || pathname.startsWith(`${root}/`)) {
      return root;
    }
  }
  return null;
}

/** Agent id when the path is one of that agent's jobs pages, else null. */
export function getAgentJobsPathAgentId(
  pathname: string | null | undefined,
): string | null {
  return (pathname && AGENT_JOBS_PATH.exec(pathname)?.[1]) || null;
}

/** The campaign list a campaign page came from, like its own Back link. */
function adsListHref(searchParams: SearchParamsLike): string {
  const projectId = searchParams?.get?.("projectId");
  const accountId = searchParams?.get?.("accountId");
  if (!projectId || !accountId) {
    return "/ads";
  }
  const range = searchParams?.get?.("range");
  return campaignsHref(
    projectId,
    accountId,
    RANGE_PARAMS.find((param): param is RangeParam => param === range),
  );
}

/**
 * Back target for main list routes and their nested pages.
 * Tab list roots → null; Agents root → home; non-tab hub roots → Chats
 * (Soko Bot setup opened from Home → home); nested → list root.
 * You page rows outside `/you/` (Account, Billing, Connections, SEO, Ads) and
 * You submenus → You, named. You row list roots opened from You → You, named.
 * Ads pages (campaigns) → the Ads list for their project, account and range.
 * Developer sections → the You → Developer menu; their detail pages → the
 * section list.
 */
export function resolveMobileAppBackTarget(
  pathname: string | null | undefined,
  searchParams?: SearchParamsLike,
): MobileAppBackTarget | null {
  if (!pathname) {
    return null;
  }
  if (isOpenedYouRow(pathname, searchParams)) {
    return BACK_TO_YOU;
  }
  if (pathname.startsWith("/ads/")) {
    return { href: adsListHref(searchParams), labelKey: "back" };
  }
  if (
    YOU_HUB_CHILD_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return BACK_TO_YOU;
  }
  // Developer sections open from the You → Developer menu; a detail page
  // (coworker, task, vendor) goes back to its list.
  const developerPath = DEVELOPER_PATH.exec(pathname);
  if (developerPath) {
    const [, section, detail] = developerPath;
    return {
      href: detail ? `/developer/${section}` : "/you/developer",
      labelKey: "back",
    };
  }
  const root = findMainAppListRoot(pathname);
  if (!root) {
    return null;
  }
  if (root === "/newsletter") {
    if (MOBILE_TAB_LIST_PATH_SET.has(pathname)) {
      return { href: "/", labelKey: "back" };
    }
    return {
      href: scopedHref(
        pathname.startsWith("/newsletter/issues/")
          ? "/newsletter/issues"
          : "/newsletter",
        searchParams?.get?.(PROJECT_SCOPE_PARAM) ?? null,
      ),
      labelKey: "back",
    };
  }
  if (pathname === root) {
    if (
      root === "/agents" ||
      root === "/drive" ||
      root === "/calendar" ||
      root === "/schedules" ||
      root === "/contacts" ||
      root === "/social" ||
      root === "/studio" ||
      root === "/tiktok-studio"
    ) {
      return { href: "/", labelKey: "back" };
    }
    if (MOBILE_TAB_LIST_PATH_SET.has(root)) {
      return null;
    }
    // Soko Bot setup opened from Home goes back to Home.
    if (
      root === "/personal-assistant" &&
      searchParams?.get?.("from") === "home"
    ) {
      return { href: "/", labelKey: "goHome" };
    }
    return { href: CHAT_CHATS_LIST_PATH, labelKey: "backToChats" };
  }
  // An agent's jobs go back to that agent, not the catalog. The top bar swaps
  // in the catalog when the agent is unavailable (`useIsAgentUnavailable`).
  const agentId = getAgentJobsPathAgentId(pathname);
  if (agentId) {
    return { href: `/agents/${agentId}`, labelKey: "back" };
  }
  return root === "/you" ? BACK_TO_YOU : { href: root, labelKey: "back" };
}

/**
 * Fixed tab bar: Welcome home / chats list / other chat shell (except
 * rooms) + tab list roots and non-tab hubs. `/` is home chrome, not a
 * chat shell path.
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
  const surface = classifyChatChromeSurface(pathname, searchParams);
  if (surface === "home" || surface === "chats") {
    return true;
  }
  if (isChatShellPathname(pathname)) {
    return true;
  }
  return (
    MOBILE_TAB_LIST_PATH_SET.has(pathname) ||
    MOBILE_NON_TAB_HUB_LIST_PATH_SET.has(pathname)
  );
}

/**
 * Leading slot shows Sokosumi brand on Chats list and every bottom-nav tab
 * root (Tasks / Projects / You). Agents, Social and Studio keep back to home.
 * Nested pages keep back.
 * `/history` keeps brand chrome after Search left the tab bar.
 * You row list roots opened from You show back to You instead.
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
  if (isOpenedYouRow(pathname, searchParams)) {
    return false;
  }
  if (
    pathname === "/agents" ||
    pathname === "/social" ||
    pathname === "/studio" ||
    pathname === "/tiktok-studio" ||
    pathname === "/newsletter" ||
    pathname.startsWith("/newsletter/")
  ) {
    return false;
  }
  return MOBILE_TAB_LIST_PATH_SET.has(pathname);
}
