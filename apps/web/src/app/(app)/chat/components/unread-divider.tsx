"use client";

import { useTranslations } from "next-intl";

import { DayPill } from "@/app/chat/components/day-separator";

interface UnreadDividerProps {
  /** The day label when the day changes at the same message, else null. */
  dayLabel: string | null;
}

/**
 * The Unread divider (SOK-1481): a primary hairline across the transcript
 * with "New" in its middle, above the first unread message. When the day
 * changes at the same message, the day label sits in the middle before
 * "New" instead of on a row of its own.
 */
export function UnreadDivider({ dayLabel }: UnreadDividerProps) {
  const t = useTranslations("App.Channels");
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <span aria-hidden className="bg-primary h-px flex-1" />
      {dayLabel ? <DayPill>{dayLabel}</DayPill> : null}
      <span aria-hidden className="text-primary text-xs font-semibold">
        {t("UnreadDivider.label")}
      </span>
      {/* The separator is the line itself, so the day label stays readable. */}
      <span
        role="separator"
        aria-label={t("UnreadDivider.accessibleName")}
        className="bg-primary h-px flex-1"
      />
    </div>
  );
}
