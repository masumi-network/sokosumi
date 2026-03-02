"use client";

import { useLocale } from "next-intl";

import {
  formatShortDate,
  formatShortDateTime,
  formatTimeAgo,
  getDateGroupKey,
} from "@/lib/utils/datetime";

export function useLocalizedDateTime() {
  const locale = useLocale();

  return {
    locale,
    formatShortDate: (date: string | Date) => formatShortDate(date, locale),
    formatShortDateTime: (date: string | Date) =>
      formatShortDateTime(date, locale),
    formatTimeAgo: (date: string | Date) => formatTimeAgo(date, locale),
    getDateGroupKey: (dateInput: Date | number) =>
      getDateGroupKey(dateInput, locale),
  };
}
