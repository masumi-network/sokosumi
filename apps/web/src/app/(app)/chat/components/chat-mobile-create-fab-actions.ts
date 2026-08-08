export type MobileCreateFabSurface = "chats";

export type MobileCreateFabActionId = "createChannel" | "newDm";

export interface MobileCreateFabAction {
  id: MobileCreateFabActionId;
  href: string;
}

const CHATS_ACTIONS: readonly MobileCreateFabAction[] = [
  { id: "createChannel", href: "/chat?create=channel" },
  { id: "newDm", href: "/chat?dm=new" },
] as const;

/** Create actions for the mobile FAB overlay menu (existing routes only). */
export function mobileCreateFabActions(
  _surface: MobileCreateFabSurface = "chats",
): readonly MobileCreateFabAction[] {
  return CHATS_ACTIONS;
}

/**
 * FAB sits above the docked tab bar with a small gap.
 * Full static Tailwind strings (dynamic class assembly would break purge).
 */
export const CHAT_MOBILE_CREATE_FAB_BOTTOM =
  "bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)]" as const;

/** FAB above the floating Apple tab bar. */
export const CHAT_MOBILE_CREATE_FAB_BOTTOM_APPLE =
  "bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom))+0.75rem)]" as const;

export function chatMobileCreateFabBottom(isApple: boolean): string {
  return isApple
    ? CHAT_MOBILE_CREATE_FAB_BOTTOM_APPLE
    : CHAT_MOBILE_CREATE_FAB_BOTTOM;
}

/** Scrim ends above the docked tab bar so tab hit targets stay free. */
export const CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM =
  "bottom-[calc(4rem+env(safe-area-inset-bottom))]" as const;

export const CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM_APPLE =
  "bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))]" as const;

export function chatMobileCreateFabScrimBottom(isApple: boolean): string {
  return isApple
    ? CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM_APPLE
    : CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM;
}
