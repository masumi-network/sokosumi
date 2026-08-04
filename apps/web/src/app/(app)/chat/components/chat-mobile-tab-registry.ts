import { History, Home, type LucideIcon, Search } from "lucide-react";

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
 * Room composer outer padding. Bar clearance comes from
 * `CHAT_MOBILE_HEIGHT_SHELL_CLASS` / shell `pb-16`; keep safe-area here.
 */
export const CHAT_MOBILE_ROOM_COMPOSER_PADDING_CLASSNAME =
  "px-5 pt-2 md:pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-[max(1.5rem,env(safe-area-inset-bottom))]" as const;

export type ChatMobileTabId = "home" | "history" | "search";

export type ChatMobileTabLabelKey = "home" | "history" | "search";

interface ChatMobileTabBase {
  labelKey: ChatMobileTabLabelKey;
  icon: LucideIcon;
}

export interface ChatMobileLinkTab extends ChatMobileTabBase {
  kind: "link";
  id: "home" | "history";
  href: "/chat" | "/history";
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
    isActive: (pathname) =>
      pathname === "/chat" || pathname.startsWith("/chat/"),
  },
  {
    id: "history",
    kind: "link",
    href: "/history",
    labelKey: "history",
    icon: History,
    isActive: (pathname) => pathname === "/history",
  },
  {
    id: "search",
    kind: "search-action",
    labelKey: "search",
    icon: Search,
  },
];
