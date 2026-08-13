/**
 * Mobile chat-root list shell (`ChatMobileRoomList` + Instant Nav skeleton).
 *
 * Cancel authenticated-app-frame main `p-4` on top/sides only so rows can go
 * edge-to-edge. Do **not** use `-m-4` / `-mb-4`: negative bottom margin pulls
 * AppMobileChrome's in-flow tab-bar spacer up into the last DM rows, so the
 * fixed bottom nav clips them (Faizan / last-room bug).
 *
 * `pb-3` is comfortable gap above the tab bar after the spacer clears it.
 * Grow with content — never nest `min-h-0` + `overflow-y-auto` here (that
 * height-locks and leaves the spacer outside the list scrollport).
 */
export const CHAT_CHATS_MOBILE_LIST_SHELL_CLASS =
  "bg-background md:hidden -mt-4 -mx-4 flex flex-1 flex-col pb-3" as const;
