"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Soft-land notice when `/chat/rooms/{id}` redirects for missing/forbidden room.
 * Query: `?notice=room-unavailable` on Welcome (`/`).
 */
export function ChatLandingNotice({ notice }: { notice: string | null }) {
  const t = useTranslations("App.Channels");
  const router = useRouter();

  useEffect(() => {
    if (notice !== "room-unavailable") {
      return;
    }
    toast.error(t("roomUnavailable"));
    router.replace("/", { scroll: false });
  }, [notice, router, t]);

  return null;
}
