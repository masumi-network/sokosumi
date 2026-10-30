"use client";

import { useTranslations } from "next-intl";

import { DayPill } from "@/app/chat/components/day-separator";

interface UnreadDividerProps {
  /** The day label when the day changes at the same message, else null. */
  dayLabel: string | null;
}

/**
 * The Unread divider (SOK-1481): a foreground hairline across the transcript
 * with "New" at its trailing end, above the first unread message. When the
 * day changes at the same message, the day label sits in the middle of the
 * line, where a row of its own would center it.
 */
export function UnreadDivider({ dayLabel }: UnreadDividerProps) {
  const t = useTranslations("App.Channels");
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      {dayLabel ? (
        <>
          <span aria-hidden className="bg-foreground h-px flex-1" />
          <DayPill>{dayLabel}</DayPill>
        </>
      ) : null}
      {/* Equal flex with the leading line, so "New" does not push the pill off center. */}
      <div className="flex flex-1 items-center gap-2">
        {/* The separator is the line itself, so the day label stays readable. */}
        <span
          role="separator"
          aria-label={t("UnreadDivider.accessibleName")}
          className="bg-foreground h-px flex-1"
        />
        <span aria-hidden className="text-foreground text-xs font-semibold">
          {t("UnreadDivider.label")}
        </span>
      </div>
    </div>
  );
}
