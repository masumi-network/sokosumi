/**
 * Day separator label in the reader's locale: today, yesterday, a weekday
 * within the last week, else a medium date ("Nov 2, 2026", "02.11.2026").
 * Without a locale the runtime default is used.
 */
export function formatDaySeparator(date: Date, locale?: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  // Rounded: a DST change makes one calendar day 23 or 25 hours long.
  const daysDiff = Math.round(
    (today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  const label =
    daysDiff === 0 || daysDiff === 1
      ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
          -daysDiff,
          "day",
        )
      : daysDiff > 1 && daysDiff < 7
        ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
            messageDate,
          )
        : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
            messageDate,
          );
  // "today", "lunes": a label on its own starts upper case.
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}
