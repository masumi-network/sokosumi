import { SOCIAL_POST_MIN_SCHEDULE_LEAD_MS } from "@sokosumi/utils";

export interface SocialQueueSlotTime {
  weekday: number;
  minutesFromMidnight: number;
  timezone: string;
}

const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
const QUEUE_LOOKAHEAD_WEEKS = 12;

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offset = getTimezoneOffsetMs(new Date(utcGuess), timeZone);
  let result = new Date(utcGuess - offset);
  offset = getTimezoneOffsetMs(result, timeZone);
  result = new Date(utcGuess - offset);
  return Number.isNaN(result.getTime()) ? null : result;
}

function zonedDateParts(
  date: Date,
  timeZone: string,
): {
  weekday: number;
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const weekday = WEEKDAY_SHORT.indexOf(
    values.weekday as (typeof WEEKDAY_SHORT)[number],
  );
  return {
    weekday,
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function addUtcCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function socialQueueSlotOccurrence(
  slot: SocialQueueSlotTime,
  from: Date,
  weekOffset: number,
): Date | null {
  const today = zonedDateParts(from, slot.timezone);
  if (today.weekday < 0) return null;
  const delta = ((slot.weekday - today.weekday + 7) % 7) + weekOffset * 7;
  const date = addUtcCalendarDays(today.year, today.month, today.day, delta);
  const hour = Math.floor(slot.minutesFromMidnight / 60);
  const minute = slot.minutesFromMidnight % 60;
  return zonedWallToUtc(
    date.year,
    date.month,
    date.day,
    hour,
    minute,
    slot.timezone,
  );
}

export function minuteKey(value: Date): number {
  return Math.floor(value.getTime() / 60_000);
}

export function nextSocialQueueSlotAt(
  slots: readonly SocialQueueSlotTime[],
  occupied: readonly Date[],
  from: Date,
  minLeadMs = SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  maxWeeks = QUEUE_LOOKAHEAD_WEEKS,
): Date | null {
  if (slots.length === 0) return null;
  const taken = new Set(occupied.map(minuteKey));
  const earliest = from.getTime() + minLeadMs;
  let soonest: Date | null = null;
  for (let week = 0; week <= maxWeeks; week += 1) {
    for (const slot of slots) {
      const at = socialQueueSlotOccurrence(slot, from, week);
      if (!at || at.getTime() <= earliest) continue;
      if (taken.has(minuteKey(at))) continue;
      if (!soonest || at.getTime() < soonest.getTime()) soonest = at;
    }
    if (soonest) return soonest;
  }
  return soonest;
}
