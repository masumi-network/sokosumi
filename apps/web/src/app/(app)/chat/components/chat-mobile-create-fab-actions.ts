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
