"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback } from "react";
import { formatNotificationTimeLabel } from "@/lib/utils/notification-time-label";

export function useNotificationTimeFormatter() {
  const t = useTranslations("Components.NotificationCenter");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });

  return useCallback(
    (timestamp: string | Date) =>
      formatNotificationTimeLabel(timestamp, now, formatter, t("justNow")),
    [formatter, now, t],
  );
}
