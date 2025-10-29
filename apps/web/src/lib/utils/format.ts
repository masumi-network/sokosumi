export function formatDateTimeMedium(
  dateTime: IntlDateFormatter["dateTime"],
  date: Date,
): string {
  return dateTime(date, { dateStyle: "medium", timeStyle: "medium" });
}
