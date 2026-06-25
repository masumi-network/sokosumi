"use client";

import { useFormatter, useNow } from "next-intl";
import { useCallback } from "react";

export function useNotificationTimeFormatter() {
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });

  return useCallback(
    (timestamp: string | Date) => {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      const diffMs = now.getTime() - date.getTime();
      const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDay < 7) {
        return formatter.relativeTime(date, now);
      }

      return formatter.dateTime(date, {
        month: "short",
        day: "numeric",
      });
    },
    [formatter, now],
  );
}
