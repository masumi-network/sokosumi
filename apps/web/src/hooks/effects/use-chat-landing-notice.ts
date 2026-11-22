"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Shows the room-unavailable toast and strips `?notice=room-unavailable` from
 * Welcome (`/`) when a chat room redirect lands with that query notice.
 */
export function useChatLandingNotice(notice: string | null): void {
  const t = useTranslations("App.Channels");
  const router = useRouter();

  useEffect(() => {
    if (notice !== "room-unavailable") {
      return;
    }
    toast.error(t("roomUnavailable"));
    router.replace("/", { scroll: false });
  }, [notice, router, t]);
}
