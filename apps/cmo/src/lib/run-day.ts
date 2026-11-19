/**
 * When one of Cuso's runs happens: "Monday 23 November at 09:00". Every page
 * words a run this way, with its time, so two runs on different days (the
 * site audit and the weekly review) never read as one run on two days.
 */
export function runDay(
  at: Date | string,
  timeZone: string | undefined,
  { time = true }: { time?: boolean } = {},
): string {
  const date = new Date(at);
  const day = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(timeZone ? { timeZone } : {}),
  });
  if (!time) return day;
  const clock = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
  return `${day} at ${clock}`;
}
