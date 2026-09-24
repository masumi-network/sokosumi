import { isValidTimezone } from "@sokosumi/utils";
import { CronExpressionParser as cronParser } from "cron-parser";
import type {
  TaskSchedule,
  TaskScheduleRule,
  TaskScheduleRuleReplacement,
} from "@/lib/clients/generated/core/types.gen";
import { DOW, parseCron } from "@/lib/schedules/cron";
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

/** A complete, valid schedule form: one start time, or a repeating rule. */
type ParsedTaskScheduleSelection =
  | { mode: "once"; runAt: Date }
  | {
      mode: "recurring";
      expr: string;
      timezone?: string;
      endsMode?: TaskScheduleEndsMode;
      endsOn?: Date;
      occurrences?: number;
      intervalDays?: number;
      anchorAt?: Date;
    };

interface RecurringRuleFields {
  expr: string;
  timezone: string;
  endsMode: TaskScheduleEndsMode;
  endsOn?: Date | string | null;
  intervalDays?: number | null;
  anchorAt?: Date | string | null;
  endAfterOccurrences?: number;
}

/** The schedule form's starting state for an existing repeating rule. */
function recurringRuleToSelection(
  rule: RecurringRuleFields,
): TaskScheduleSelection {
  const derivedPreset = derivePresetFromCron(rule.expr);
  const selection: TaskScheduleSelection = {
    mode: "recurring",
    timezone: rule.timezone,
    cron: rule.expr,
    endsMode: rule.endsMode,
    endAfterOccurrences: rule.endAfterOccurrences,
    ...(rule.intervalDays != null && rule.intervalDays > 1
      ? { intervalDays: rule.intervalDays }
      : {}),
    endOnLocalDate: rule.endsOn
      ? utcToDateTimeLocalInTimezone(
          new Date(rule.endsOn),
          rule.timezone,
        ).slice(0, 10)
      : undefined,
  };

  // Every-N-days runs at its anchor's local time; the cron's time is unused.
  // The daily preset would replace that anchor with the next local slot and
  // shift the series, so it starts from the anchor, with the daily cron the
  // form's builder writes for that time (older rules can carry another one).
  if (rule.intervalDays != null && rule.intervalDays > 1 && rule.anchorAt) {
    const anchorLocalIso = utcToDateTimeLocalInTimezone(
      new Date(rule.anchorAt),
      rule.timezone,
    );
    selection.oneTimeLocalIso = anchorLocalIso;
    selection.cron = `${Number(anchorLocalIso.slice(14, 16))} ${Number(anchorLocalIso.slice(11, 13))} * * *`;
  } else if (derivedPreset) {
    selection.oneTimeLocalIso = derivedPreset.iso;
  } else {
    selection.customCronExpr = rule.expr;
  }

  return selection;
}

const ENDS_MODE_FROM_RULE = {
  NEVER: TaskScheduleEndsMode.NEVER,
  ON: TaskScheduleEndsMode.ON,
  AFTER: TaskScheduleEndsMode.AFTER,
} as const satisfies Record<
  TaskScheduleRule["endsMode"] & string,
  TaskScheduleEndsMode
>;

const ENDS_MODE_TO_RULE = {
  [TaskScheduleEndsMode.NEVER]: "NEVER",
  [TaskScheduleEndsMode.ON]: "ON",
  [TaskScheduleEndsMode.AFTER]: "AFTER",
} as const satisfies Record<TaskScheduleEndsMode, TaskScheduleRule["endsMode"]>;

/** The schedule form's starting state for a Task Schedule's rule. */
export function taskScheduleRuleToSelection(
  rule: TaskSchedule["rule"],
): TaskScheduleSelection {
  return recurringRuleToSelection({
    expr: rule.expr,
    timezone: rule.timezone,
    endsMode: ENDS_MODE_FROM_RULE[rule.endsMode],
    endsOn: rule.endsOn,
    intervalDays: rule.intervalDays,
    anchorAt: rule.anchorAt,
    endAfterOccurrences: rule.targetRunCount ?? undefined,
  });
}

/**
 * The Task Schedule rule for what the schedule form holds, or null when it is
 * incomplete or invalid. A one-time pick has no rule: a schedule repeats.
 */
export function selectionToTaskScheduleRule(
  selection: TaskScheduleSelection,
): TaskScheduleRuleReplacement | null {
  if (selection.mode !== "recurring") return null;
  const parsed = parseTaskScheduleSelection(selection);
  if (!parsed || parsed.mode !== "recurring") return null;
  return {
    expr: parsed.expr,
    timezone: parsed.timezone ?? selection.timezone,
    endsMode: ENDS_MODE_TO_RULE[parsed.endsMode ?? TaskScheduleEndsMode.NEVER],
    endsOn: parsed.endsOn ?? null,
    targetRunCount: parsed.occurrences ?? null,
    intervalDays: parsed.intervalDays ?? null,
    anchorAt: parsed.anchorAt ?? null,
  };
}

export function parseTaskScheduleSelection(
  selection: TaskScheduleSelection,
): ParsedTaskScheduleSelection | null {
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

const ONCE_SCHEDULE_LEAD_MS = 5 * 60 * 1000;
const ONCE_SCHEDULE_RETRY_MS = 60_000;
const ONCE_SCHEDULE_MAX_ATTEMPTS = 5;

function isSchedulableOnce(oneTimeLocalIso: string, timezone: string): boolean {
  return Boolean(
    parseTaskScheduleSelection({
      mode: "once",
      timezone,
      oneTimeLocalIso,
    }),
  );
}

export function schedulableOnceLocalIso(
  oneTimeLocalIso: string,
  timezone: string,
): string {
  if (isSchedulableOnce(oneTimeLocalIso, timezone)) {
    return oneTimeLocalIso;
  }

  if (
    !isValidTimezone(timezone) ||
    !isValidCalendarDateTime(oneTimeLocalIso) ||
    !zonedDateTimeLocalToUtc(oneTimeLocalIso, timezone)
  ) {
    return oneTimeLocalIso;
  }

  let leadMs = ONCE_SCHEDULE_LEAD_MS;
  for (let attempt = 0; attempt < ONCE_SCHEDULE_MAX_ATTEMPTS; attempt++) {
    const candidate = utcToDateTimeLocalInTimezone(
      new Date(Date.now() + leadMs),
      timezone,
    );
    if (isSchedulableOnce(candidate, timezone)) {
      return candidate;
    }
    leadMs += ONCE_SCHEDULE_RETRY_MS;
  }

  return utcToDateTimeLocalInTimezone(new Date(Date.now() + leadMs), timezone);
}

export function isValidCronExpression(expr: string, timezone: string): boolean {
  try {
    cronParser.parse(expr, { tz: timezone });
    return true;
  } catch {
    return false;
  }
}

function normalizeParsedScheduleValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeParsedScheduleValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        normalizeParsedScheduleValue(entryValue),
      ]),
    );
  }

  return value;
}

function areParsedSchedulesEqual(
  left: ParsedTaskScheduleSelection | null,
  right: ParsedTaskScheduleSelection | null,
): boolean {
  if (left === null && right === null) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return (
    JSON.stringify(normalizeParsedScheduleValue(left)) ===
    JSON.stringify(normalizeParsedScheduleValue(right))
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

  const originalSchedule = parseTaskScheduleSelection(original);
  const currentSchedule = parseTaskScheduleSelection(current);
  return !areParsedSchedulesEqual(originalSchedule, currentSchedule);
}

export { DOW };
