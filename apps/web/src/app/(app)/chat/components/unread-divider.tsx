"use client";

import { useTranslations } from "next-intl";

/**
 * The Unread divider (SOK-1481): a primary hairline across the transcript
 * with a trailing "New", above the first unread message. When the day
 * changes at the same message, the day label sits on the line instead of on
 * a row of its own.
 */
export function UnreadDivider({ dayLabel }: { dayLabel: string | null }) {
  const t = useTranslations("App.Channels");
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      {dayLabel ? (
        <>
          <span aria-hidden className="bg-primary h-px flex-1" />
          {/* DaySeparator's pill. */}
          <span className="text-muted-foreground bg-senary rounded-full px-3 py-1 text-xs font-medium">
            {dayLabel}
          </span>
        </>
      ) : null}
      <div
        role="separator"
        aria-label={t("UnreadDivider.accessibleName")}
        className="flex flex-1 items-center gap-2"
      >
        <span aria-hidden className="bg-primary h-px flex-1" />
        <span aria-hidden className="text-primary text-xs font-medium">
          {t("UnreadDivider.label")}
        </span>
      </div>
    </div>
  );
}
