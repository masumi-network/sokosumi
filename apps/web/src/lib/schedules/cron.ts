// Centralized cron parsing and helpers for schedules
import { CronExpressionParser as cronParser } from "cron-parser";

export const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export type Dow = (typeof DOW)[number];

export interface DailyAtTime {
  kind: "dailyAtTime";
  hour: number;
  minute: number;
}

export interface WeeklyAtTime {
  kind: "weeklyAtTime";
  hour: number;
  minute: number;
  dows: Dow[]; // one or many
}

export interface MonthlyOnDay {
  kind: "monthlyOnDay";
  hour: number;
  minute: number;
  dayOfMonth: number; // 1..31
}

export interface DailyEveryN {
  kind: "dailyEveryN";
  hour: number;
  minute: number;
  everyNDays: number; // 1..*
}

export interface MonthlyEveryN {
  kind: "monthlyEveryN";
  hour: number;
  minute: number;
  dayOfMonth: number; // 1..31
  everyNMonths: number; // 1..*
}

export type ParsedCron =
  | DailyAtTime
  | WeeklyAtTime
  | MonthlyOnDay
  | DailyEveryN
  | MonthlyEveryN
  | { kind: "unknown" };

export function parseCron(cron: string): ParsedCron {
  const trimmed = (cron ?? "").trim();
  if (!trimmed) return { kind: "unknown" };
  try {
    const exp = cronParser.parse(trimmed);
    const fields = exp.fields.serialize();

    const minute = getSingleNumeric(fields.minute.values);
    const hour = getSingleNumeric(fields.hour.values);
    if (minute == null || hour == null) return { kind: "unknown" };

    const dom = fields.dayOfMonth;
    const mon = fields.month;
    const dow = fields.dayOfWeek;

    // daily exact time: m h * * *
    if (dom.wildcard && mon.wildcard && dow.wildcard) {
      return { kind: "dailyAtTime", hour, minute };
    }

    // weekly at time with DOW list: m h * * MON(,TUE)*
    if (dom.wildcard && mon.wildcard && !dow.wildcard) {
      const values = dow.values;
      if (
        Array.isArray(values) &&
        values.length > 0 &&
        values.every((v) => typeof v === "number")
      ) {
        const dows = (values as number[]).map(
          (n) => DOW[((n % 7) + 7) % 7] as Dow,
        );
        if (dows.length > 0)
          return { kind: "weeklyAtTime", hour, minute, dows };
      }
    }

    // monthly fixed DOM: m h D * *
    if (!dom.wildcard && mon.wildcard && dow.wildcard) {
      const day = getSingleNumeric(dom.values);
      if (day != null) {
        return { kind: "monthlyOnDay", hour, minute, dayOfMonth: day };
      }
    }

    // daily every N days: m h */N * *
    if (!dom.wildcard && mon.wildcard && dow.wildcard) {
      const everyNDays = inferStepFromRange(dom.values, 1);
      if (everyNDays != null && everyNDays > 0) {
        return { kind: "dailyEveryN", hour, minute, everyNDays };
      }
    }

    // monthly every N months on day D: m h D */N *
    if (dow.wildcard) {
      const day = getSingleNumeric(dom.values);
      const everyNMonths = inferStepFromRange(mon.values, 1);
      if (day != null && everyNMonths != null && everyNMonths > 0) {
        return {
          kind: "monthlyEveryN",
          hour,
          minute,
          dayOfMonth: day,
          everyNMonths,
        };
      }
    }

    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

export function formatTime(
  hour: number,
  minute: number,
  timezone?: string,
): string {
  const base = new Date();
  base.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(base);
}

export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dowToIndex(dow: Dow): number {
  return DOW.indexOf(dow);
}

function getUpcomingDateForWeekday(
  weekday: Dow,
  hour: number,
  minute: number,
  now: Date,
): Date {
  const targetIndex = dowToIndex(weekday);
  const base = new Date(now);
  base.setHours(hour, minute, 0, 0);
  const baseDay = base.getDay();
  const diff = (targetIndex - baseDay + 7) % 7;
  base.setDate(base.getDate() + diff);
  if (base <= now) base.setDate(base.getDate() + 7);
  return base;
}

export function computeNextOccurrence(
  parsed: ParsedCron,
  now: Date,
  _timezone?: string,
): Date | null {
  switch (parsed.kind) {
    case "dailyAtTime": {
      const base = new Date(now);
      base.setHours(parsed.hour, parsed.minute, 0, 0);
      if (base <= now) base.setDate(base.getDate() + 1);
      return base;
    }
    case "weeklyAtTime": {
      // choose the earliest next among provided dows
      let best: Date | null = null;
      for (const d of parsed.dows) {
        const candidate = getUpcomingDateForWeekday(
          d,
          parsed.hour,
          parsed.minute,
          now,
        );
        if (!best || candidate < best) best = candidate;
      }
      return best;
    }
    case "monthlyOnDay": {
      const base = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        parsed.hour,
        parsed.minute,
        0,
        0,
      );
      const daysInMonth = getDaysInMonth(base.getFullYear(), base.getMonth());
      const safeDay = Math.min(parsed.dayOfMonth, daysInMonth);
      base.setDate(safeDay);
      if (base <= now) {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const daysNext = getDaysInMonth(
          nextMonth.getFullYear(),
          nextMonth.getMonth(),
        );
        const safeNext = Math.min(parsed.dayOfMonth, daysNext);
        nextMonth.setDate(safeNext);
        nextMonth.setHours(parsed.hour, parsed.minute, 0, 0);
        return nextMonth;
      }
      return base;
    }
    default:
      return null; // not supported here; use cron library if needed
  }
}

function getSingleNumeric(values: (number | string)[]): number | null {
  return values.length === 1 && typeof values[0] === "number"
    ? (values[0] as number)
    : null;
}

function inferStepFromRange(
  values: (number | string)[],
  requiredStart: number,
): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length !== values.length) return null;
  if (nums.length < 2) return null;
  if (nums[0] !== requiredStart) return null;
  const step = nums[1] - nums[0];
  if (!Number.isFinite(step) || step <= 0) return null;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] !== step) return null;
  }
  return step;
}
