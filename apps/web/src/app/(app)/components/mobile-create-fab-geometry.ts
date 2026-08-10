/**
 * Shared FAB geometry for Chat multi-action and list single-action create FABs.
 * Full static Tailwind strings (dynamic class assembly would break purge).
 */

/** FAB sits above the docked tab bar with a small gap. */
export const MOBILE_CREATE_FAB_BOTTOM =
  "bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)]" as const;

/** FAB above the floating Apple tab bar. */
export const MOBILE_CREATE_FAB_BOTTOM_APPLE =
  "bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom))+0.75rem)]" as const;

export function mobileCreateFabBottom(isApple: boolean): string {
  return isApple ? MOBILE_CREATE_FAB_BOTTOM_APPLE : MOBILE_CREATE_FAB_BOTTOM;
}

/**
 * List scroll padding so the last row clears the floating create FAB
 * (`size-14` + 1rem gap). Separate from tab-bar spacer
 * (`chatMobileTabBarClearance` / `CHAT_MOBILE_TAB_BAR_CLEARANCE*`).
 * `md:pb-0` keeps desktop list padding unchanged when the class is always applied.
 */
export const LIST_MOBILE_CREATE_FAB_CLEARANCE =
  "pb-[calc(3.5rem+1rem)] md:pb-0" as const;
