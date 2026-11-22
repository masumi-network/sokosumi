"use client";

import { useChatLandingNotice } from "@/hooks/effects/use-chat-landing-notice";

/**
 * Soft-land notice when `/chat/rooms/{id}` redirects for missing/forbidden room.
 * Query: `?notice=room-unavailable` on Welcome (`/`).
 */
export function ChatLandingNotice({ notice }: { notice: string | null }) {
  useChatLandingNotice(notice);

  return null;
}
