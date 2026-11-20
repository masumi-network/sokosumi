"use client";

import { useTranslations } from "next-intl";
import { useRouteNoticeToast } from "@/hooks/effects/use-route-notice-toast";

/**
 * Soft-land notice when `/chat/rooms/{id}` redirects for missing/forbidden room.
 * Query: `?notice=room-unavailable` on Welcome (`/`).
 */
export function ChatLandingNotice({ notice }: { notice: string | null }) {
  const t = useTranslations("App.Channels");

  useRouteNoticeToast(
    notice === "room-unavailable"
      ? {
          variant: "error",
          message: t("roomUnavailable"),
          replaceHref: "/",
          replaceScroll: false,
        }
      : null,
  );

  return null;
}
