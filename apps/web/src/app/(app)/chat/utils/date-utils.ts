/**
 * Format date for day separators (Today, Yesterday, Day of week, or dd/mm/yyyy)
 */
export function formatDaySeparator(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  // Check if it's today
  if (
    messageDate.getTime() === today.getTime() &&
    messageDate.getMonth() === today.getMonth() &&
    messageDate.getFullYear() === today.getFullYear()
  ) {
    return "Today";
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if it's yesterday
  if (
    messageDate.getTime() === yesterday.getTime() &&
    messageDate.getMonth() === yesterday.getMonth() &&
    messageDate.getFullYear() === yesterday.getFullYear()
  ) {
    return "Yesterday";
  }

  // Check if it's within the last week
  const daysDiff = Math.floor(
    (today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysDiff < 7) {
    // Return day of the week
    const daysOfWeek = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return daysOfWeek[messageDate.getDay()];
  }

  // Format as dd/mm/yyyy
  const day = String(messageDate.getDate()).padStart(2, "0");
  const month = String(messageDate.getMonth() + 1).padStart(2, "0");
  const year = messageDate.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Check if two dates are on different days
 */
export function isDifferentDay(
  date1: Date | undefined,
  date2: Date | undefined,
): boolean {
  if (!date1 || !date2) return false;

  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());

  return d1.getTime() !== d2.getTime();
}
