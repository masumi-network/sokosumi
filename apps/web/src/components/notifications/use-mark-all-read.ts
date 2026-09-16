"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useNotifications } from "@/contexts/notification-provider";

/**
 * Mark all as read, as both frames of the Notification Center offer it: one
 * write at a time, nothing to do when nothing is unread, and a failure said
 * out loud. Only the button around it differs between the panel and the page.
 */
export function useMarkAllRead() {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount, markAllRead } = useNotifications();
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  function handleMarkAllRead(): void {
    if (isMarkingAllRead || unreadCount === 0) return;

    setIsMarkingAllRead(true);
    void markAllRead()
      .catch(() => {
        toast.error(t("markAllReadError"));
      })
      .finally(() => {
        setIsMarkingAllRead(false);
      });
  }

  return { unreadCount, isMarkingAllRead, handleMarkAllRead };
}
