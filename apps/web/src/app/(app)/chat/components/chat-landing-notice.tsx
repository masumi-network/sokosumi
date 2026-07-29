"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Soft-land notice when `/chat/rooms/{id}` redirects.
 * Query: `?notice=room-unavailable` | `?notice=room-load-failed`
 */
export function ChatLandingNotice({ notice }: { notice: string | null }) {
  const t = useTranslations("App.Channels");
  const router = useRouter();

  useEffect(() => {
    if (notice === "room-unavailable") {
      toast.error(t("roomUnavailable"));
    } else if (notice === "room-load-failed") {
      toast.error(t("roomLoadFailed"));
    } else {
      return;
    }
    router.replace("/chat", { scroll: false });
  }, [notice, router, t]);

  return null;
}
