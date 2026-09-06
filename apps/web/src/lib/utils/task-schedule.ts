import { isValidTimezone, parseTaskScheduleMetadata } from "@sokosumi/utils";
import { CronExpressionParser as cronParser } from "cron-parser";
import type { TaskScheduleInput } from "@/lib/clients/generated/core/types.gen";
import { DOW, type Dow, parseCron } from "@/lib/schedules/cron";
import {
  endOfLocalDateInTimezone,
  parseDateTimeLocalParts,
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import {
  TaskScheduleEndsMode,
  type TaskScheduleSelection,
} from "@/lib/types/task-schedule";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateTimeLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function parseDateTimeLocalInput(
  value: string | undefined,
): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function derivePresetFromCron(cron: string): {
  option: "daily" | "weekly" | "monthly";
  iso: string;
} | null {
  const parsed = parseCron(cron);
  const now = new Date();

  switch (parsed.kind) {
    case "dailyAtTime": {
      const next = new Date(now);
      next.setHours(parsed.hour, parsed.minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return { option: "daily", iso: formatDateTimeLocalInput(next) };
    }
    case "weeklyAtTime": {
      if (parsed.dows.length !== 1) return null;
      const next = new Date(now);
      next.setHours(parsed.hour, parsed.minute, 0, 0);
      return { option: "weekly", iso: formatDateTimeLocalInput(next) };
    }
    case "monthlyOnDay": {
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        parsed.dayOfMonth,
        parsed.hour,
        parsed.minute,
        0,
        0,
      );
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      return { option: "monthly", iso: formatDateTimeLocalInput(next) };
    }
    default:
      return null;
  }
}

function deriveBuilderStateFromCron(cron: string): {
  unit: "day" | "week" | "month";
  count: number;
  weekdays: Dow[];
  hour: number;
  minute: number;
} | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteStr, hourStr, dom, mon, dow] = parts;
  const minute = Number(minuteStr);
  const hour = Number(hourStr);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;

  if (dom === "*" && mon === "*" && /[A-Z,]+/.test(dow)) {
    const weekdays = dow.split(",").filter(Boolean) as Dow[];
    return { unit: "week", count: 1, weekdays, hour, minute };
  }

  const dailyEvery = dom.startsWith("*/") ? Number(dom.slice(2)) : Number.NaN;
  if (mon === "*" && dow === "*" && Number.isFinite(dailyEvery)) {
    return {
      unit: "day",
      count: Math.max(1, Number(dailyEvery)),
      weekdays: ["MON"],
      hour,
      minute,
    };
  }

  const monthlyEvery = mon.startsWith("*/") ? Number(mon.slice(2)) : Number.NaN;
  const domNum = Number(dom);
  if (Number.isFinite(monthlyEvery) && Number.isFinite(domNum) && dow === "*") {
    return {
      unit: "month",
      count: Math.max(1, Number(monthlyEvery)),
      weekdays: ["MON"],
      hour,
      minute,
    };
  }

  return null;
}

function isValidCalendarDateTime(value: string | undefined): boolean {
  const parts = parseDateTimeLocalParts(value);
  if (
    !parts ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    return false;
  }

  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute
  );
}

function getFirstUpcomingCronOccurrence(
  expr: string,
  timezone: string,
  now: Date,
): Date | null {
  try {
    return cronParser
      .parse(expr, { tz: timezone, currentDate: now })
      .next()
      .toDate();
  } catch {
    return null;
  }
}

function getFirstUpcomingIntervalOccurrence(
  anchorAt: Date,
  intervalDays: number,
  timezone: string,
  now: Date,
): Date | null {
  if (now < anchorAt) return anchorAt;

  const anchorLocal = utcToDateTimeLocalInTimezone(anchorAt, timezone);
  const nowLocal = utcToDateTimeLocalInTimezone(now, timezone);
  const anchorParts = parseDateTimeLocalParts(anchorLocal);
  const nowParts = parseDateTimeLocalParts(nowLocal);
  if (!anchorParts || !nowParts) return null;

  const anchorDate = Date.UTC(
    anchorParts.year,
    anchorParts.month - 1,
    anchorParts.day,
  );
  const nowDate = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
  const daysSinceAnchor = Math.round(
    (nowDate - anchorDate) / (24 * 60 * 60 * 1000),
  );
  const periods = Math.floor(daysSinceAnchor / intervalDays) + 1;
  const nextDate = new Date(anchorDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + periods * intervalDays);

  return zonedDateTimeLocalToUtc(
    `${nextDate.getUTCFullYear()}-${pad2(nextDate.getUTCMonth() + 1)}-${pad2(nextDate.getUTCDate())}T${anchorLocal.slice(11)}`,
    timezone,
  );
}

function getFirstUpcomingRecurringOccurrence(
  expr: string,
  timezone: string,
  now: Date,
  intervalDays: number | undefined,
  anchorAt: Date | null | undefined,
): Date | null {
  if (intervalDays != null && intervalDays > 1 && anchorAt) {
    return getFirstUpcomingIntervalOccurrence(
      anchorAt,
      intervalDays,
      timezone,
      now,
    );
  }

  return getFirstUpcomingCronOccurrence(expr, timezone, now);
}

export function metadataToSelection(
  metadata: string | null | undefined,
  defaultTimezone: string,
): TaskScheduleSelection {
  const parsed = parseTaskScheduleMetadata(metadata);
  if (!parsed) {
    return { mode: "none", timezone: defaultTimezone };
  }

  if (parsed.mode === "once") {
    const timezone = parsed.version === 2 ? parsed.timezone : defaultTimezone;
    const runAt = parsed.version === 2 ? parsed.effectiveRunAt : parsed.runAt;
    return {
      mode: "once",
      timezone,
      oneTimeLocalIso: utcToDateTimeLocalInTimezone(new Date(runAt), timezone),
    };
  }

  const derivedPreset = derivePresetFromCron(parsed.expr);
  const remainingOccurrences =
    parsed.version === 1
      ? parsed.occurrences
      : parsed.targetReleaseCount == null
        ? undefined
        : Math.max(parsed.targetReleaseCount - parsed.epochReleaseCount, 0);
  const selection: TaskScheduleSelection = {
    mode: "recurring",
    timezone: parsed.timezone,
    cron: parsed.expr,
    endsMode: parsed.endsMode,
    endAfterOccurrences: remainingOccurrences,
    ...(parsed.intervalDays != null && parsed.intervalDays > 1
      ? { intervalDays: parsed.intervalDays }
      : {}),
    endOnLocalDate: parsed.endsOn
      ? utcToDateTimeLocalInTimezone(
          new Date(parsed.endsOn),
          parsed.timezone,
        ).slice(0, 10)
      : undefined,
  };

  if (derivedPreset) {
    selection.oneTimeLocalIso = derivedPreset.iso;
  } else if (
    parsed.intervalDays != null &&
    parsed.intervalDays > 1 &&
    parsed.anchorAt
  ) {
    selection.oneTimeLocalIso = utcToDateTimeLocalInTimezone(
      new Date(parsed.anchorAt),
      parsed.timezone,
    );
    selection.customCronExpr = parsed.expr;
  } else {
    selection.customCronExpr = parsed.expr;
    const derived = deriveBuilderStateFromCron(parsed.expr);
    if (derived) {
      selection.cron = parsed.expr;
    }
  }

  return selection;
}

export function selectionToApiBody(
  selection: TaskScheduleSelection,
): TaskScheduleInput | null {
  const timezone = selection.timezone.trim();
  if (!isValidTimezone(timezone)) return null;
  const now = new Date();

  if (selection.mode === "once") {
    if (!isValidCalendarDateTime(selection.oneTimeLocalIso)) return null;
    const runAt = zonedDateTimeLocalToUtc(selection.oneTimeLocalIso, timezone);
    if (!runAt || runAt <= now) return null;
    return { mode: "once", runAt };
  }

  if (selection.mode === "recurring") {
    const expr = selection.customCronExpr?.trim() || selection.cron?.trim();
    if (!expr || !isValidCronExpression(expr, timezone)) return null;

    const endsMode = selection.endsMode ?? TaskScheduleEndsMode.NEVER;
    if (!Object.values(TaskScheduleEndsMode).includes(endsMode)) return null;

    const intervalDays = selection.intervalDays;
    if (
      intervalDays != null &&
      (!Number.isInteger(intervalDays) || intervalDays < 1)
    ) {
      return null;
    }

    const anchorAt =
      intervalDays != null && intervalDays > 1
        ? zonedDateTimeLocalToUtc(selection.oneTimeLocalIso, timezone)
        : undefined;

    if (
      intervalDays != null &&
      intervalDays > 1 &&
      (!isValidCalendarDateTime(selection.oneTimeLocalIso) || !anchorAt)
    ) {
      return null;
    }

    const endsOn =
      endsMode === TaskScheduleEndsMode.ON
        ? selection.endOnLocalDate &&
          isValidCalendarDateTime(`${selection.endOnLocalDate}T00:00`)
          ? endOfLocalDateInTimezone(selection.endOnLocalDate, timezone)
          : null
        : undefined;
    if (endsMode === TaskScheduleEndsMode.ON && !endsOn) return null;

    if (endsOn) {
      const firstOccurrence = getFirstUpcomingRecurringOccurrence(
        expr,
        timezone,
        now,
        intervalDays,
        anchorAt,
      );
      if (!firstOccurrence || endsOn < firstOccurrence) return null;
    }

    const occurrences = selection.endAfterOccurrences;
    if (
      endsMode === TaskScheduleEndsMode.AFTER &&
      (!Number.isInteger(occurrences) || !occurrences || occurrences < 1)
    ) {
      return null;
    }

    return {
      mode: "recurring",
      expr,
      timezone,
      endsMode,
      ...(intervalDays != null && intervalDays > 1 && anchorAt
        ? { intervalDays, anchorAt }
        : {}),
      ...(endsOn ? { endsOn } : {}),
      ...(endsMode === TaskScheduleEndsMode.AFTER && occurrences
        ? { occurrences }
        : {}),
    };
  }

  return null;
}

export function isValidCronExpression(expr: string, timezone: string): boolean {
  try {
    cronParser.parse(expr, { tz: timezone });
    return true;
  } catch {
    return false;
  }
}

function normalizeScheduleApiBodyValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeScheduleApiBodyValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        normalizeScheduleApiBodyValue(entryValue),
      ]),
    );
  }

  return value;
}

function areScheduleApiBodiesEqual(
  left: TaskScheduleInput | null,
  right: TaskScheduleInput | null,
): boolean {
  if (left === null && right === null) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return (
    JSON.stringify(normalizeScheduleApiBodyValue(left)) ===
    JSON.stringify(normalizeScheduleApiBodyValue(right))
  );
}

export function hasTaskScheduleChanged(
  original: TaskScheduleSelection,
  current: TaskScheduleSelection | undefined,
  hadSchedule: boolean,
): boolean {
  if (!current || current.mode === "none") {
    return hadSchedule;
  }

  if (!hadSchedule) {
    return true;
  }

  const originalBody = selectionToApiBody(original);
  const currentBody = selectionToApiBody(current);
  return !areScheduleApiBodiesEqual(originalBody, currentBody);
}

export { DOW };
