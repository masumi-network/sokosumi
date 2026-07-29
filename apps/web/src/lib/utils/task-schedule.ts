import { CronExpressionParser as cronParser } from "cron-parser";
import type { PutTaskScheduleRequest } from "@/lib/clients/generated/core/types.gen";
import { DOW, type Dow, parseCron } from "@/lib/schedules/cron";
import {
  endOfLocalDateInTimezone,
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import {
  TaskScheduleEndsMode,
  type TaskScheduleSelection,
} from "@/lib/types/task-schedule";

interface TaskScheduleMetadataOnce {
  version: 1;
  mode: "once";
  scheduledAt: string;
  runAt: string;
}

interface TaskScheduleMetadataRecurring {
  version: 1;
  mode: "recurring";
  scheduledAt: string;
  expr: string;
  timezone: string;
  endsMode: "never" | "on" | "after";
  endsOn?: string;
  occurrences?: number;
  intervalDays?: number;
  anchorAt?: string;
}

type TaskScheduleMetadata =
  | TaskScheduleMetadataOnce
  | TaskScheduleMetadataRecurring;

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

export function parseTaskScheduleMetadata(
  metadata: string | null | undefined,
): TaskScheduleMetadata | null {
  if (!metadata) return null;

  try {
    const parsed = JSON.parse(metadata) as TaskScheduleMetadata;
    if (parsed.version !== 1) return null;
    if (parsed.mode !== "once" && parsed.mode !== "recurring") return null;
    return parsed;
  } catch {
    return null;
  }
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
    return {
      mode: "once",
      timezone: defaultTimezone,
      oneTimeLocalIso: utcToDateTimeLocalInTimezone(
        new Date(parsed.runAt),
        defaultTimezone,
      ),
    };
  }

  const derivedPreset = derivePresetFromCron(parsed.expr);
  const selection: TaskScheduleSelection = {
    mode: "recurring",
    timezone: parsed.timezone,
    cron: parsed.expr,
    endsMode: parsed.endsMode,
    endAfterOccurrences: parsed.occurrences,
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
): PutTaskScheduleRequest | null {
  if (selection.mode === "once") {
    const runAt = zonedDateTimeLocalToUtc(
      selection.oneTimeLocalIso,
      selection.timezone,
    );
    if (!runAt) return null;
    return { mode: "once", runAt };
  }

  if (selection.mode === "recurring") {
    const expr = selection.customCronExpr?.trim() || selection.cron?.trim();
    if (!expr) return null;

    const endsMode = selection.endsMode ?? TaskScheduleEndsMode.NEVER;
    const intervalDays = selection.intervalDays;
    const anchorAt =
      intervalDays != null && intervalDays > 1
        ? zonedDateTimeLocalToUtc(selection.oneTimeLocalIso, selection.timezone)
        : undefined;

    if (intervalDays != null && intervalDays > 1 && !anchorAt) {
      return null;
    }

    return {
      mode: "recurring",
      expr,
      timezone: selection.timezone,
      endsMode,
      ...(intervalDays != null && intervalDays > 1 && anchorAt
        ? { intervalDays, anchorAt }
        : {}),
      ...(endsMode === TaskScheduleEndsMode.ON && selection.endOnLocalDate
        ? (() => {
            const endsOn = endOfLocalDateInTimezone(
              selection.endOnLocalDate,
              selection.timezone,
            );
            return endsOn ? { endsOn } : {};
          })()
        : {}),
      ...(endsMode === TaskScheduleEndsMode.AFTER &&
      selection.endAfterOccurrences
        ? { occurrences: selection.endAfterOccurrences }
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
  left: PutTaskScheduleRequest | null,
  right: PutTaskScheduleRequest | null,
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
