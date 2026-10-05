import { CronExpressionParser as cronParser } from "cron-parser";

import { DOW, type Dow, parseCron } from "@/lib/schedules/cron";
import {
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import {
  TaskScheduleEndsMode,
  type TaskScheduleSelection,
} from "@/lib/types/task-schedule";

/** How a Task Schedule repeats, as the schedule dialog offers it. */
export type ScheduleRepeat =
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "interval"
  | "custom";

/** The "When" section's state. Every rule a schedule can hold maps onto it. */
export interface ScheduleWhen {
  repeat: ScheduleRepeat;
  /** `HH:MM`, in `timezone`. */
  time: string;
  weekdays: Dow[];
  dayOfMonth: number;
  /** For `interval`: the day step and the date it counts from. */
  intervalDays: number;
  startDate: string;
  customCron: string;
  timezone: string;
  endsMode: TaskScheduleEndsMode;
  endOnLocalDate: string | null;
  endAfterOccurrences: number;
}

export const WORKWEEK: readonly Dow[] = ["MON", "TUE", "WED", "THU", "FRI"];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function todayIn(timezone: string, now: Date): string {
  return utcToDateTimeLocalInTimezone(now, timezone).slice(0, 10);
}

function isWorkweek(days: readonly Dow[]): boolean {
  return (
    days.length === WORKWEEK.length &&
    WORKWEEK.every((day) => days.includes(day))
  );
}

/** The dialog's starting state for a rule. */
export function selectionToWhen(
  selection: TaskScheduleSelection,
  now: Date = new Date(),
): ScheduleWhen {
  const timezone = selection.timezone;
  const today = todayIn(timezone, now);
  const base: ScheduleWhen = {
    repeat: "daily",
    time: "09:00",
    weekdays: [DOW[now.getDay()] as Dow],
    dayOfMonth: Math.min(Number(today.slice(8, 10)), 28),
    intervalDays: 2,
    startDate: today,
    customCron: "",
    timezone,
    endsMode: selection.endsMode ?? TaskScheduleEndsMode.NEVER,
    endOnLocalDate: selection.endOnLocalDate ?? null,
    endAfterOccurrences: selection.endAfterOccurrences ?? 10,
  };
  const cron = selection.customCronExpr?.trim() || selection.cron?.trim() || "";
  const parsed = parseCron(cron);
  const time =
    parsed.kind === "unknown"
      ? null
      : `${pad2(parsed.hour)}:${pad2(parsed.minute)}`;

  if (selection.intervalDays != null && selection.intervalDays > 1) {
    const anchor = selection.firstRunLocalIso;
    return {
      ...base,
      repeat: "interval",
      intervalDays: selection.intervalDays,
      startDate: anchor?.slice(0, 10) || today,
      time: anchor?.slice(11, 16) || time || base.time,
    };
  }
  if (!time) return { ...base, repeat: "custom", customCron: cron };

  switch (parsed.kind) {
    case "dailyAtTime":
      return { ...base, repeat: "daily", time };
    case "weeklyAtTime":
      return isWorkweek(parsed.dows)
        ? { ...base, repeat: "weekdays", time }
        : { ...base, repeat: "weekly", time, weekdays: parsed.dows };
    case "monthlyOnDay":
      return {
        ...base,
        repeat: "monthly",
        time,
        dayOfMonth: parsed.dayOfMonth,
      };
    default:
      return { ...base, repeat: "custom", customCron: cron, time };
  }
}

/** The cron a "When" state runs on, or null while it is incomplete. */
export function whenCron(when: ScheduleWhen): string | null {
  if (when.repeat === "custom") return when.customCron.trim() || null;
  const match = TIME_PATTERN.exec(when.time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  switch (when.repeat) {
    case "daily":
    case "interval":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * ${WORKWEEK.join(",")}`;
    case "weekly": {
      const days = DOW.filter((day) => when.weekdays.includes(day));
      return days.length > 0 ? `${minute} ${hour} * * ${days.join(",")}` : null;
    }
    case "monthly":
      return `${minute} ${hour} ${when.dayOfMonth} * *`;
  }
}

/** What the dialog saves for a "When" state. */
export function whenToSelection(when: ScheduleWhen): TaskScheduleSelection {
  const cron = whenCron(when) ?? "";
  const interval = when.repeat === "interval";
  return {
    timezone: when.timezone,
    cron,
    ...(when.repeat === "custom" ? { customCronExpr: cron } : {}),
    // Core runs an every-N-days rule from its anchor's local date and time.
    ...(interval
      ? {
          intervalDays: Math.max(2, Math.floor(when.intervalDays)),
          firstRunLocalIso: `${when.startDate}T${when.time}`,
        }
      : {}),
    endsMode: when.endsMode,
    ...(when.endsMode === TaskScheduleEndsMode.ON && when.endOnLocalDate
      ? { endOnLocalDate: when.endOnLocalDate }
      : {}),
    ...(when.endsMode === TaskScheduleEndsMode.AFTER
      ? { endAfterOccurrences: Math.max(1, when.endAfterOccurrences) }
      : {}),
  };
}

/** Calendar days from `from` to `to`, counted in `timezone`. */
function localDaysBetween(from: Date, to: Date, timezone: string): number {
  const day = (date: Date) =>
    Date.parse(`${utcToDateTimeLocalInTimezone(date, timezone).slice(0, 10)}Z`);
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/** The next runs a selection produces, honouring its interval and its end. */
export function upcomingRuns(
  selection: TaskScheduleSelection,
  count: number,
  now: Date = new Date(),
): Date[] {
  const cron = selection.customCronExpr?.trim() || selection.cron?.trim();
  if (!cron) return [];
  const timezone = selection.timezone;
  const step =
    selection.intervalDays != null && selection.intervalDays > 1
      ? selection.intervalDays
      : null;
  const anchor =
    step && selection.firstRunLocalIso
      ? zonedDateTimeLocalToUtc(selection.firstRunLocalIso, timezone)
      : null;
  const endsOn =
    selection.endsMode === TaskScheduleEndsMode.ON && selection.endOnLocalDate
      ? zonedDateTimeLocalToUtc(`${selection.endOnLocalDate}T23:59`, timezone)
      : null;
  const limit =
    selection.endsMode === TaskScheduleEndsMode.AFTER &&
    selection.endAfterOccurrences
      ? Math.min(count, selection.endAfterOccurrences)
      : count;
  try {
    const currentDate =
      anchor && anchor > now ? new Date(anchor.getTime() - 60_000) : now;
    const interval = cronParser.parse(cron, { currentDate, tz: timezone });
    const runs: Date[] = [];
    let guard = 40 + limit * (step ?? 1);
    while (runs.length < limit && guard-- > 0) {
      const next = interval.next().toDate();
      if (endsOn && next > endsOn) break;
      if (
        step &&
        anchor &&
        localDaysBetween(anchor, next, timezone) % step !== 0
      ) {
        continue;
      }
      runs.push(next);
    }
    return runs;
  } catch {
    return [];
  }
}
