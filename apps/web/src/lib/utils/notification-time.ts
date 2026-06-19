"use client";

import { useFormatter } from "next-intl";
import { useCallback } from "react";

export function useNotificationTimeFormatter() {
  const formatter = useFormatter();

  return useCallback(
    (timestamp: string | Date) => {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      const now = Date.now();
      const diffMs = now - date.getTime();
      const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDay < 7) {
        return formatter.relativeTime(date);
      }

      return formatter.dateTime(date, {
        month: "short",
        day: "numeric",
      });
    },
    [formatter],
  );
}
