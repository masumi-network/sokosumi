import { Home, type LucideIcon, MessageCircle, Search } from "lucide-react";

import {
  classifyChatChromeSurface,
  isChatRoomPathname,
} from "@/app/chat/utils/chat-route-base";
import { isMainAppMobileChromePathname } from "@/app/components/mobile-app-chrome";

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
 * Height shell when the mobile tab bar spacer is present.
 * Mobile fills the flex slot above the spacer; desktop keeps the svh shell.
 * Apple float inset lives on the spacer, not here.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_CLASS =
  "h-[calc(100svh-64px)] max-md:h-full" as const;

/**
 * Full shell height when the mobile tab bar is hidden (room surface).
 * Matches desktop/`md` height — no tab-bar spacer below.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS =
  "h-[calc(100svh-64px)]" as const;

/** Height class for chat views: room path drops tab-bar spacer offset. */
export function chatMobileHeightShellClass(
  pathname: string | null | undefined,
  _isApple = false,
): string {
  if (isChatRoomPathname(pathname)) {
    return CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS;
  }
  return CHAT_MOBILE_HEIGHT_SHELL_CLASS;
}

export type ChatMobileTabId = "home" | "chats" | "search";
export type ChatMobileTabLabelKey = "home" | "chats" | "search";

export interface ChatMobileTab {
  kind: "link";
  id: ChatMobileTabId;
  href: "/chat" | "/chat/chats" | "/history";
  labelKey: ChatMobileTabLabelKey;
  icon: LucideIcon;
  isActive: (pathname: string, searchParams?: SearchParamsLike) => boolean;
}

export const CHAT_MOBILE_TABS: readonly ChatMobileTab[] = [
  {
    id: "home",
    kind: "link",
    href: "/chat",
    labelKey: "home",
    icon: Home,
    isActive: (pathname, searchParams) => {
      // Draft flows (`?create=channel`, `?dm=new`) share pathname `/chat` but
      // are not Home — classifyChatChromeSurface returns "other-chat".
      if (classifyChatChromeSurface(pathname, searchParams) === "home") {
        return true;
      }
      return isMainAppMobileChromePathname(pathname) && pathname !== "/history";
    },
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
