// Centralized cron parsing and helpers for schedules

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

function isValidDow(v: string): v is Dow {
  return (DOW as readonly string[]).includes(v);
}

export function parseCron(cron: string): ParsedCron {
  const trimmed = (cron ?? "").trim();
  if (!trimmed) return { kind: "unknown" };

  // daily exact time: m h * * *
  let m = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/.exec(trimmed);
  if (m) {
    return {
      kind: "dailyAtTime",
      hour: Number(m[2]),
      minute: Number(m[1]),
    };
  }

  // weekly single or multi DOW list: m h * * MON(,TUE)*
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* ([A-Z]{3}(?:,[A-Z]{3})*)$/.exec(
    trimmed,
  );
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const dows = m[3]
      .split(",")
      .filter(Boolean)
      .map((s) => s.toUpperCase())
      .filter(isValidDow) as Dow[];
    if (dows.length > 0) return { kind: "weeklyAtTime", hour, minute, dows };
  }

  // monthly fixed DOM: m h D * *
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) ([0-2]?\d|3[01]) \* \*$/.exec(trimmed);
  if (m) {
    return {
      kind: "monthlyOnDay",
      hour: Number(m[2]),
      minute: Number(m[1]),
      dayOfMonth: Number(m[3]),
    };
  }

  // daily every N days: m h */N * *
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) \*\/([1-9]\d*) \* \*$/.exec(trimmed);
  if (m) {
    return {
      kind: "dailyEveryN",
      hour: Number(m[2]),
      minute: Number(m[1]),
      everyNDays: Number(m[3]),
    };
  }

  // monthly every N months on day D: m h D */N *
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) ([0-2]?\d|3[01]) \*\/([1-9]\d*) \*$/.exec(
    trimmed,
  );
  if (m) {
    return {
      kind: "monthlyEveryN",
      hour: Number(m[2]),
      minute: Number(m[1]),
      dayOfMonth: Number(m[3]),
      everyNMonths: Number(m[4]),
    };
  }

  return { kind: "unknown" };
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
