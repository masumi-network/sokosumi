/** Both `useFormatter()` and `getFormatter()` give this shape. */
interface TimeLabelFormatter {
  relativeTime: (date: Date, now: Date) => string;
  dateTime: (date: Date, options: { month: "short"; day: "numeric" }) => string;
}

/**
 * A notification's time as the Notification Center shows it. Outside the
 * client hook so a Server Component can render the same label.
 */
export function formatNotificationTimeLabel(
  timestamp: string | Date,
  now: Date,
  formatter: TimeLabelFormatter,
  justNow: string,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Seconds are noise: "33 seconds ago" and "just now" mean the same.
  if (diffMs < 60_000) {
    return justNow;
  }

  if (diffDay < 7) {
    return formatter.relativeTime(date, now);
  }

  return formatter.dateTime(date, {
    month: "short",
    day: "numeric",
  });
}
