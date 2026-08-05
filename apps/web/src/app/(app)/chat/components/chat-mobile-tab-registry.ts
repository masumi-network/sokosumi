import { Home, type LucideIcon, MessageCircle, Search } from "lucide-react";

import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";
import { isMainAppMobileChromePathname } from "@/app/components/mobile-app-chrome";

/**
 * Floating Apple tab bar sits at
 * `bottom-[max(0.75rem,env(safe-area-inset-bottom))]` with inner `h-14`/`h-16`.
 * Clearance / offsets below must stay as full static Tailwind class strings.
 */

/** Tailwind padding-bottom for docked bar height. Applied at shell content wrapper. */
export const CHAT_MOBILE_TAB_BAR_CLEARANCE = "pb-16" as const;

/** Extra clearance for floating Apple tab bar (bar height + float inset). */
export const CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE =
  "pb-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))]" as const;

export function chatMobileTabBarClearance(isApple: boolean): string {
  return isApple
    ? CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE
    : CHAT_MOBILE_TAB_BAR_CLEARANCE;
}

/** Fixed composer bottom offset so chrome sits above the docked tab bar on mobile. */
export const CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET =
  "bottom-16 md:bottom-0" as const;

/** Composer offset above the floating Apple tab bar. */
export const CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET_APPLE =
  "bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))] md:bottom-0" as const;

export function chatMobileTabBarBottomOffset(isApple: boolean): string {
  return isApple
    ? CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET_APPLE
    : CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET;
}

/**
 * Viewport height shell pairing with `CHAT_MOBILE_TAB_BAR_CLEARANCE` (`4rem`).
 * Subtracts the tab bar below `md` so fixed-height chat views do not sit under it.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_CLASS =
  "h-[calc(100svh-64px)] max-md:h-[calc(100svh-64px-4rem)]" as const;

/** Height shell when the floating Apple tab bar is visible. */
export const CHAT_MOBILE_HEIGHT_SHELL_CLASS_APPLE =
  "h-[calc(100svh-64px)] max-md:h-[calc(100svh-64px-4rem-max(0.75rem,env(safe-area-inset-bottom)))]" as const;

/**
 * Full shell height when the mobile tab bar is hidden (room surface).
 * Matches desktop/`md` height — no 4rem tab-bar subtraction.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS =
  "h-[calc(100svh-64px)]" as const;

/** Height class for chat views: room path drops tab-bar offset. */
export function chatMobileHeightShellClass(
  pathname: string | null | undefined,
  isApple = false,
): string {
  if (isChatRoomPathname(pathname)) {
    return CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS;
  }
  return isApple
    ? CHAT_MOBILE_HEIGHT_SHELL_CLASS_APPLE
    : CHAT_MOBILE_HEIGHT_SHELL_CLASS;
}

export type ChatMobileTabId = "home" | "chats" | "search";
export type ChatMobileTabLabelKey = "home" | "chats" | "search";

export interface ChatMobileTab {
  kind: "link";
  id: ChatMobileTabId;
  href: "/chat" | "/chat/chats" | "/history";
  labelKey: ChatMobileTabLabelKey;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
}

export const CHAT_MOBILE_TABS: readonly ChatMobileTab[] = [
  {
    id: "home",
    kind: "link",
    href: "/chat",
    labelKey: "home",
    icon: Home,
    isActive: (pathname) =>
      pathname === "/chat" ||
      (isMainAppMobileChromePathname(pathname) && pathname !== "/history"),
  },
  {
    id: "chats",
    kind: "link",
    href: "/chat/chats",
    labelKey: "chats",
    icon: MessageCircle,
    isActive: (pathname) => pathname === "/chat/chats",
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
