"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAccountNoticeCopy } from "@/app/components/account-notice-row";
import { useAccountNoticeAction } from "@/app/components/use-account-notice-action";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { NOTIFICATION_TOASTER_ID } from "@/lib/constants/notification-toaster";

const ACCOUNT_NOTICE_TOAST_ID = "account-notice";

function getAccountNoticeSessionStorageKey(sessionId: string): string {
  return `accountNoticeShown-${sessionId}`;
}

export function LoginAccountNoticeToast() {
  const { notice, sessionId } = useAccountNotice();
  const copy = useAccountNoticeCopy();
  const { handleAction } = useAccountNoticeAction();
  const t = useTranslations("Components.NotificationCenter");
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
      id: ACCOUNT_NOTICE_TOAST_ID,
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
      action: {
        label: t("view"),
        onClick: () => {
          void (async () => {
            await handleAction();
            toast.dismiss(ACCOUNT_NOTICE_TOAST_ID);
          })();
        },
      },
    });

    try {
      sessionStorage.setItem(storageKey, "true");
    } catch {
      // Ignore quota or private browsing errors.
    }
  }, [copy, handleAction, notice, sessionId, t]);

  return null;
}
