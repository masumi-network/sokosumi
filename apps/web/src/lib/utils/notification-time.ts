/**
 * Formats a notification timestamp into a relative time string.
 * Examples: "just now", "2m ago", "1h ago", "3d ago", "Jan 15"
 */
export function formatNotificationTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return "just now";
  }

  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }

  if (diffDay < 7) {
    return `${diffDay}d ago`;
  }

  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
