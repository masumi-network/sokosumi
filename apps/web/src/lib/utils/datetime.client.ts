"use client";

import { useLocale, useTimeZone } from "next-intl";
import { useMemo } from "react";

import { DEFAULT_TIME_ZONE } from "@/i18n/time-zone";
import {
  formatShortDate,
  formatShortDateTime,
  formatTimeAgo,
  getDateGroupKey,
} from "@/lib/utils/datetime";

export function useLocalizedDateTime() {
  const locale = useLocale();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;

  return useMemo(
    () => ({
      locale,
      formatShortDate: (date: string | Date) =>
        formatShortDate(date, locale, timeZone),
      formatShortDateTime: (date: string | Date) =>
        formatShortDateTime(date, locale, timeZone),
      formatTimeAgo: (date: string | Date) => formatTimeAgo(date, locale),
      getDateGroupKey: (dateInput: Date | number) =>
        getDateGroupKey(dateInput, locale),
    }),
    [locale, timeZone],
  );
}
