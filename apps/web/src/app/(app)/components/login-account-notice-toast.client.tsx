"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAccountNoticeCopy } from "@/app/components/account-notice-row";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";

function getAccountNoticeSessionStorageKey(sessionId: string): string {
  return `accountNoticeShown-${sessionId}`;
}

export function LoginAccountNoticeToast() {
  const { notice, sessionId } = useAccountNotice();
  const copy = useAccountNoticeCopy();
  const hasShownRef = useRef(false);

  useEffect(() => {
    if (!notice || !copy || hasShownRef.current) {
      return;
    }

    const storageKey = getAccountNoticeSessionStorageKey(sessionId);

    try {
      if (sessionStorage.getItem(storageKey) === "true") {
        return;
      }
    } catch {
      return;
    }

    hasShownRef.current = true;

    const borderColor =
      notice.tone === "destructive"
        ? "var(--semantic-destructive)"
        : "var(--semantic-warning)";

    toast(copy.title, {
      description: copy.description,
      duration: 10_000,
      toasterId: NOTIFICATION_TOASTER_ID,
      classNames: {
        toast: "items-center gap-3",
        title: "w-full min-w-0",
        content: "min-w-0 flex-1",
      },
      style: {
        borderColor,
      },
    });

    try {
      sessionStorage.setItem(storageKey, "true");
    } catch {
      // Ignore quota or private browsing errors.
    }
  }, [copy, notice, sessionId]);

  return null;
}
