"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback } from "react";

export function useNotificationTimeFormatter() {
  const t = useTranslations("Components.NotificationCenter");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });

  return useCallback(
    (timestamp: string | Date) => {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      const diffMs = now.getTime() - date.getTime();
      const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // Seconds are noise: "33 seconds ago" and "just now" mean the same.
      if (diffMs < 60_000) {
        return t("justNow");
      }

      if (diffDay < 7) {
        return formatter.relativeTime(date, now);
      }

      return formatter.dateTime(date, {
        month: "short",
        day: "numeric",
      });
    },
    [formatter, now, t],
  );
}
