import { Home, type LucideIcon, MessageCircle, Search } from "lucide-react";

import { isChatRoomPathname } from "@/app/chat/utils/chat-route-base";

/** Tailwind padding-bottom for bar height. Applied at shell content wrapper. */
export const CHAT_MOBILE_TAB_BAR_CLEARANCE = "pb-16" as const;

/** Fixed composer bottom offset so chrome sits above the tab bar on mobile. */
export const CHAT_MOBILE_TAB_BAR_BOTTOM_OFFSET =
  "bottom-16 md:bottom-0" as const;

/**
 * Viewport height shell pairing with `CHAT_MOBILE_TAB_BAR_CLEARANCE` (`4rem`).
 * Subtracts the tab bar below `md` so fixed-height chat views do not sit under it.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_CLASS =
  "h-[calc(100svh-64px)] max-md:h-[calc(100svh-64px-4rem)]" as const;

/**
 * Full shell height when the mobile tab bar is hidden (room surface).
 * Matches desktop/`md` height — no 4rem tab-bar subtraction.
 */
export const CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS =
  "h-[calc(100svh-64px)]" as const;

/** Height class for chat views: room path drops tab-bar offset. */
export function chatMobileHeightShellClass(
  pathname: string | null | undefined,
): string {
  return isChatRoomPathname(pathname)
    ? CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS
    : CHAT_MOBILE_HEIGHT_SHELL_CLASS;
}

export type ChatMobileTabId = "home" | "chats" | "search";
export type ChatMobileTabLabelKey = "home" | "chats" | "search";

interface ChatMobileTabBase {
  labelKey: ChatMobileTabLabelKey;
  icon: LucideIcon;
}

export interface ChatMobileLinkTab extends ChatMobileTabBase {
  kind: "link";
  id: "home" | "chats";
  href: "/chat" | "/chat/chats";
  isActive: (pathname: string) => boolean;
}

export interface ChatMobileSearchTab extends ChatMobileTabBase {
  kind: "search-action";
  id: "search";
}

export type ChatMobileTab = ChatMobileLinkTab | ChatMobileSearchTab;

export const CHAT_MOBILE_TABS: readonly ChatMobileTab[] = [
  {
    id: "home",
    kind: "link",
    href: "/chat",
    labelKey: "home",
    icon: Home,
    isActive: (pathname) => pathname === "/chat",
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
    kind: "search-action",
    labelKey: "search",
    icon: Search,
  },
];
