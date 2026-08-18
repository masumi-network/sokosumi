import {
  FolderKanban,
  Home,
  ListTodo,
  type LucideIcon,
  MessageCircle,
  Search,
} from "lucide-react";

import { classifyChatChromeSurface } from "@/app/chat/utils/chat-route-base";

type SearchParamsLike =
  | URLSearchParams
  | { get?: (key: string) => string | null }
  | null
  | undefined;

/**
 * Floating Apple tab bar sits at
 * `bottom-[max(0.75rem,env(safe-area-inset-bottom))]` with inner `h-16`.
 * Docked bar is `h-16` + `pb-[env(safe-area-inset-bottom)]`.
 * Clearance / offsets below must stay as full static Tailwind class strings.
 */

/**
 * Spacer height for the docked tab bar (bar + home-indicator safe area).
 * Used as an in-flow `h-*` sibling under page content — not `pb-*` on a
 * height-locked flex child (that fails to extend main's scroll overflow).
 */
export const CHAT_MOBILE_TAB_BAR_CLEARANCE =
  "h-[calc(4rem+env(safe-area-inset-bottom))]" as const;

/** Spacer height for the floating Apple tab bar (bar + float inset). */
export const CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE =
  "h-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))]" as const;

export function chatMobileTabBarClearance(isApple: boolean): string {
  return isApple
    ? CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE
    : CHAT_MOBILE_TAB_BAR_CLEARANCE;
}

/** Fixed composer bottom offset so chrome sits above the docked tab bar on mobile. */
export const CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET =
  "bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0" as const;

/** Composer offset above the floating Apple tab bar. */
export const CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET_APPLE =
  "bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))] md:bottom-0" as const;

export function chatMobileTabBarBottomOffset(isApple: boolean): string {
  return isApple
    ? CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET_APPLE
    : CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET;
}

/**
 * Composer outer `pb-*` when the mobile tab is hidden (room / draft).
 * Matches Apple float bottom inset: `max(0.75rem, env(safe-area-inset-bottom))`.
 * Drop on soft-keyboard open — layout already clears the home indicator.
 */
export const CHAT_MOBILE_COMPOSER_SAFE_AREA_PB =
  "pb-[max(0.75rem,env(safe-area-inset-bottom))]" as const;

/** Desktop composer outer `pb-*` (unchanged from prior md: path). */
export const CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD =
  "md:pb-[max(1.5rem,env(safe-area-inset-bottom))]" as const;

/**
 * Mobile safe-area `pb-*` plus desktop `md:pb-*`.
 * When the keyboard is open, omit mobile inset so the composer sits flush
 * above the keyboard (md path unchanged).
 */
export function chatMobileComposerSafeAreaPbClass(
  keyboardOpen = false,
): string {
  if (keyboardOpen) {
    return CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD;
  }
  return `${CHAT_MOBILE_COMPOSER_SAFE_AREA_PB} ${CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD}`;
}

/**
 * Height shell when the mobile tab bar spacer is present.
 * Mobile fills the flex slot above the spacer; desktop keeps the svh shell.
 * Apple float inset lives on the spacer, not here.
 * `4rem` matches header row; subtract top safe-area under cover.
 * Full static class strings so Tailwind JIT sees them.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_CLASS =
  "h-[calc(100svh-4rem-env(safe-area-inset-top))] max-md:h-full" as const;

/**
 * Full shell height when the mobile tab bar is hidden (room / draft compose).
 * Matches desktop/`md` height — no tab-bar spacer below.
 * Same below-header calc as `APP_SHELL_BELOW_HEADER_HEIGHT_CLASS`.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS =
  "h-[calc(100svh-4rem-env(safe-area-inset-top))]" as const;

/** Height class for chat views: room and draft compose drop tab-bar spacer offset. */
export function chatMobileHeightShellClass(
  pathname: string | null | undefined,
  _isApple = false,
  searchParams?: SearchParamsLike,
): string {
  const surface = classifyChatChromeSurface(pathname, searchParams);
  if (surface === "room" || surface === "draft") {
    return CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS;
  }
  return CHAT_MOBILE_HEIGHT_SHELL_CLASS;
}

export type ChatMobileTabId =
  | "home"
  | "tasks"
  | "chats"
  | "projects"
  | "search";
export type ChatMobileTabLabelKey =
  | "home"
  | "tasks"
  | "chats"
  | "projects"
  | "search";

export interface ChatMobileTab {
  kind: "link";
  id: ChatMobileTabId;
  href: "/" | "/tasks" | "/chat" | "/projects" | "/history";
  labelKey: ChatMobileTabLabelKey;
  icon: LucideIcon;
  isActive: (pathname: string, searchParams?: SearchParamsLike) => boolean;
}

export const CHAT_MOBILE_TABS: readonly ChatMobileTab[] = [
  {
    id: "home",
    kind: "link",
    href: "/",
    labelKey: "home",
    icon: Home,
    isActive: (pathname, searchParams) =>
      classifyChatChromeSurface(pathname, searchParams) === "home" ||
      pathname === "/agents",
  },
  {
    id: "tasks",
    kind: "link",
    href: "/tasks",
    labelKey: "tasks",
    icon: ListTodo,
    isActive: (pathname) => pathname === "/tasks",
  },
  {
    id: "chats",
    kind: "link",
    href: "/chat",
    labelKey: "chats",
    icon: MessageCircle,
    isActive: (pathname, searchParams) =>
      classifyChatChromeSurface(pathname, searchParams) === "chats",
  },
  {
    id: "projects",
    kind: "link",
    href: "/projects",
    labelKey: "projects",
    icon: FolderKanban,
    isActive: (pathname) => pathname === "/projects",
  },
  {
    id: "search",
    kind: "link",
    href: "/history",
    labelKey: "search",
    icon: Search,
    isActive: (pathname) => pathname === "/history",
  },
];
