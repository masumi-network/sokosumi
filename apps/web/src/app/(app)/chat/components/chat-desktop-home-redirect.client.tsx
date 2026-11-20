"use client";

import { CHAT_WELCOME_PATH } from "@/app/chat/utils/chat-route-base";
import { MOBILE_BREAKPOINT } from "@/hooks/effects/use-mobile";
import { useReplaceRouteOnMedia } from "@/hooks/effects/use-replace-route-on-media";

/**
 * Desktop has no chats-list page (sidebar owns DMs/channels). Bare `/chat`
 * on `md+` replaces to Welcome. Mobile keeps the list. Mount only when the
 * list page is actually rendering (draft/notice already redirected server-side).
 */
export function ChatDesktopHomeRedirect(): null {
  useReplaceRouteOnMedia(
    `(min-width: ${MOBILE_BREAKPOINT}px)`,
    CHAT_WELCOME_PATH,
  );
  return null;
}
