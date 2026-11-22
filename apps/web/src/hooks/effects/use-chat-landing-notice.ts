"use client";

import type { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Shows the room-unavailable toast and strips `?notice=room-unavailable` from
 * Welcome (`/`) when a chat room redirect lands with that query notice.
 */
export function useChatLandingNotice(
  notice: string | null,
  router: Pick<ReturnType<typeof useRouter>, "replace">,
  t: (key: "roomUnavailable") => string,
): void {
  useEffect(() => {
    if (notice !== "room-unavailable") {
      return;
    }
    toast.error(t("roomUnavailable"));
    router.replace("/", { scroll: false });
  }, [notice, router, t]);
}
