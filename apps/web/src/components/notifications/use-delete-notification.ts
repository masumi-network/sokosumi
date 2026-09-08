"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import { useNotifications } from "@/contexts/notification-provider";

/**
 * The delete action both notification surfaces share.
 *
 * The page draws a button beside a row. The bell draws a menu item, because a
 * button nested in a menu item is not reachable by keyboard. Only the element
 * differs, so the action lives here.
 *
 * There is no pending state: both surfaces drop the row before the request
 * goes out, so the control is gone by the time an answer arrives.
 */
export function useDeleteNotification(notificationId: string) {
  const t = useTranslations("Components.NotificationCenter");
  const { deleteNotification } = useNotifications();

  const requestDelete = useCallback(async (): Promise<void> => {
    try {
      await deleteNotification(notificationId);
    } catch {
      toast.error(t("deleteError"));
    }
  }, [deleteNotification, notificationId, t]);

  return { requestDelete };
}
