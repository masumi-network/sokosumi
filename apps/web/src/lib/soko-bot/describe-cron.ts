const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function time(hour: string, minute: string): string | null {
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/** A one-time schedule reads as its moment, in the schedule's own timezone. */
export function describeSchedule(schedule: {
  cronExpression: string;
  runOnce?: boolean;
  nextRunAt: string | Date;
  timezone: string;
}): string {
  if (!schedule.runOnce) return describeCron(schedule.cronExpression);
  try {
    const when = new Intl.DateTimeFormat("en-GB", {
      timeZone: schedule.timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(schedule.nextRunAt));
    return `Once, ${when}`;
  } catch {
    return describeCron(schedule.cronExpression);
  }
}

/**
 * Plain-language form of the common cron shapes the assistant creates;
 * anything unusual falls back to the raw expression.
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const at = time(hour, minute);
  if (minute === "*" && hour === "*") return "Every minute";
  if (/^\d{1,2}$/.test(minute) && hour === "*") return "Every hour";
  if (at && month === "*" && dayOfWeek === "*") {
    if (dayOfMonth === "L") return `Last day of each month at ${at}`;
    if (/^\d{1,2}$/.test(dayOfMonth)) {
      return `Monthly on day ${Number(dayOfMonth)} at ${at}`;
    }
  }
  const nth = /^([0-7])#([1-5])$/.exec(dayOfWeek);
  if (at && nth && dayOfMonth === "*" && month === "*") {
    const ordinal = ["First", "Second", "Third", "Fourth", "Fifth"][
      Number(nth[2]) - 1
    ];
    return `${ordinal} ${DAY_NAMES[Number(nth[1]) % 7]} of each month at ${at}`;
  }
  if (!at || dayOfMonth !== "*" || month !== "*") return cron;
  if (dayOfWeek === "*") return `Every day at ${at}`;
  if (dayOfWeek === "1-5") return `Weekdays at ${at}`;
  if (dayOfWeek === "0,6" || dayOfWeek === "6,0") return `Weekends at ${at}`;
  if (/^\d$/.test(dayOfWeek)) {
    return `Every ${DAY_NAMES[Number(dayOfWeek) % 7]} at ${at}`;
  }
  if (/^[0-6](,[0-6])+$/.test(dayOfWeek)) {
    const names = dayOfWeek
      .split(",")
      .map((d) => DAY_NAMES[Number(d) % 7]?.slice(0, 3))
      .join(", ");
    return `${names} at ${at}`;
  }
  return cron;
}
