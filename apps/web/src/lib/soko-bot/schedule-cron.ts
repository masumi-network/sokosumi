import { DOW, type Dow } from "@/lib/schedules/cron";
import { type ScheduleWhen, whenCron } from "@/lib/schedules/schedule-when";

/**
 * The cron a Soko Bot schedule saves for a "When" state, or null while it is
 * incomplete. Weekdays are numbers, the form `describeCron` reads back, so the
 * new row says "Weekdays at 09:00" rather than its raw cron.
 */
export function sokoBotScheduleCron(when: ScheduleWhen): string | null {
  const cron = whenCron(when);
  if (!cron || when.repeat === "custom") return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(" ");
  if (dayOfWeek === "*") return cron;
  const days = dayOfWeek
    .split(",")
    .map((day) => DOW.indexOf(day as Dow))
    .join(",");
  return `${minute} ${hour} ${dayOfMonth} ${month} ${days === "1,2,3,4,5" ? "1-5" : days}`;
}
