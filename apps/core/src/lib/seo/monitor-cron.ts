/** How an SEO monitor repeats, where its rule has a plain name. Any other rule reads as "Scheduled". */
export type SeoMonitorRepeat = "daily" | "weekly" | "monthly";

const MINUTE = /^([0-5]?\d)$/;
const HOUR = /^([01]?\d|2[0-3])$/;
const DAY_OF_MONTH = /^([1-9]|[12]\d|3[01])$/;
const WEEKDAY = /^([0-6]|SUN|MON|TUE|WED|THU|FRI|SAT)$/i;

/** The repeat of a cron an SEO monitor may hold, or null for any other cron. */
export function seoMonitorRepeat(expr: string): SeoMonitorRepeat | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekdays] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!MINUTE.test(minute) || !HOUR.test(hour) || month !== "*") return null;
  if (day === "*" && weekdays === "*") return "daily";
  if (day === "*") {
    const list = weekdays.split(",");
    return list.every((value) => WEEKDAY.test(value)) &&
      new Set(list.map((value) => value.toUpperCase())).size === list.length
      ? "weekly"
      : null;
  }
  return weekdays === "*" && DAY_OF_MONTH.test(day) ? "monthly" : null;
}

/**
 * A cron an SEO monitor may hold: any Sokosumi schedule rule at one time of day, so a monitor checks its pages at
 * most once a day. Each Run is a paid check: an hourly rule would spend without a limit. The schedule rule check
 * reads the day fields.
 */
export function isSeoMonitorCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return (
    fields.length === 5 && MINUTE.test(fields[0]!) && HOUR.test(fields[1]!)
  );
}
