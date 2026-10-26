import {
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";

const SLOT_MS = 15 * 60 * 1000;
/** A day picked without a time opens on the morning, like the composer's quick picks. */
const DEFAULT_DAY_TIME = "09:00";

/**
 * The instant a post started from the calendar is proposed for.
 *
 * `day` is a calendar day (`yyyy-MM-dd`) in `timeZone`, with an optional
 * wall-clock `time` (`HH:mm`) from a timeline slot. A time already gone today
 * moves to the next quarter hour at least 15 minutes out, so the composer
 * opens on a time it accepts; a day already gone proposes nothing.
 */
export function socialComposeSlot(
  day: string,
  timeZone: string,
  now: Date,
  time: string = DEFAULT_DAY_TIME,
): Date | null {
  const proposed = zonedDateTimeLocalToUtc(`${day}T${time}`, timeZone);
  if (!proposed) return null;
  if (proposed.getTime() > now.getTime()) return proposed;
  const today = utcToDateTimeLocalInTimezone(now, timeZone).slice(0, 10);
  if (day !== today) return null;
  return new Date(Math.ceil((now.getTime() + SLOT_MS) / SLOT_MS) * SLOT_MS);
}
