"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { getAccountNoticePath } from "@/app/components/account-notice-action";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useOptionalNotifications } from "@/contexts/notification-provider";

export function useAccountNoticeAction() {
  const { notice } = useAccountNotice();
  const router = useRouter();
  const notifications = useOptionalNotifications();

  const handleAction = useCallback(() => {
    if (!notice) {
      return;
    }

    // Email verification leads to the notifications page, and the notice
    // with its resend button lives on Needs you only. The page opens on the
    // remembered view otherwise, which is usually All.
    if (notice.type === "emailVerification") {
      notifications?.setView("needs-action");
    }

    router.push(getAccountNoticePath(notice));
  }, [notice, notifications, router]);

  return { handleAction, notice };
}
