"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useChatLandingNotice } from "@/hooks/effects/use-chat-landing-notice";

/**
 * Soft-land notice when `/chat/rooms/{id}` redirects for missing/forbidden room.
 * Query: `?notice=room-unavailable` on Welcome (`/`).
 */
export function ChatLandingNotice({ notice }: { notice: string | null }) {
  const t = useTranslations("App.Channels");
  const router = useRouter();

  useChatLandingNotice(notice, router, t);

  return null;
}
