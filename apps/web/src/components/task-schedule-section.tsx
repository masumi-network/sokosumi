"use client";

import { CronExpressionParser as cronParser } from "cron-parser";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  computeNextOccurrence,
  DOW,
  type Dow,
  parseCron,
} from "@/lib/schedules/cron";
import {
  getDefaultTimezone,
  getTimezoneOptions,
} from "@/lib/schedules/timezones";
import {
  gregorianDayOfWeek,
  parseDateTimeLocalParts,
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import {
  TaskScheduleEndsMode,
  type TaskScheduleSelection,
} from "@/lib/types/task-schedule";
import { cn } from "@/lib/utils";
import { isValidCronExpression } from "@/lib/utils/task-schedule";

type ScheduleOption = "daily" | "weekly" | "monthly" | "custom";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateTimeLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseDateTimeLocalInput(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function derivePresetFromCron(cron: string): {
  option: Exclude<ScheduleOption, "custom">;
  iso: string;
} | null {
  const parsed = parseCron(cron);
  const now = new Date();
  switch (parsed.kind) {
    case "dailyAtTime": {
      const next = computeNextOccurrence(parsed, now);
      if (!next) return null;
      return { option: "daily", iso: formatDateTimeLocalInput(next) };
    }
    case "weeklyAtTime": {
      // Only accept weekly when exactly one DOW, to match original behavior
      if (parsed.dows.length !== 1) return null;
      const next = computeNextOccurrence(parsed, now);
      if (!next) return null;
      return { option: "weekly", iso: formatDateTimeLocalInput(next) };
    }
    case "monthlyOnDay": {
      const next = computeNextOccurrence(parsed, now);
      if (!next) return null;
      return { option: "monthly", iso: formatDateTimeLocalInput(next) };
    }
    default:
      return null;
  }
}

type ValidationErrors = {
  firstRunLocalIso?: string;
  timeOfDay?: string;
  repeatEveryCount?: string;
  repeatWeekdays?: string;
  endOnDate?: string;
  endAfterOccurrences?: string;
  customCronExpr?: string;
};

const scheduleFormSchema = z
  .object({
    scheduleOption: z.enum(["daily", "weekly", "monthly", "custom"]),
    firstRunLocalIso: z.string().optional(),
    timeOfDay: z.string().optional(),
    repeatEveryCount: z.number().int().min(1).optional(),
    repeatEveryUnit: z.enum(["day", "week", "month"]).optional(),
    repeatWeekdays: z.array(z.enum(DOW)).optional(),
    endsMode: z.enum(["never", "on", "after"]).optional(),
    endOnDate: z.date().optional(),
    endAfterOccurrences: z.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    const now = new Date();

    function parseLocalIso(v?: string) {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // A preset's first run must be in the future
    if (data.scheduleOption !== "custom") {
      const dt = parseLocalIso(data.firstRunLocalIso);
      if (!dt)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["firstRunLocalIso"],
          message: "errors.required",
        });
      else if (dt <= now)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["firstRunLocalIso"],
          message: "errors.futureDateTime",
        });
    }

    // Custom builder rules
    if (data.scheduleOption === "custom") {
      if (
        !data.timeOfDay ||
        !/^([01]?\d|2[0-3]):([0-5]\d)$/.test(data.timeOfDay)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timeOfDay"],
          message: "errors.invalidTime",
        });

      if (!data.repeatEveryCount || data.repeatEveryCount < 1)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repeatEveryCount"],
          message: "errors.positiveInteger",
        });

      if (
        data.repeatEveryUnit === "week" &&
        (!data.repeatWeekdays || data.repeatWeekdays.length === 0)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repeatWeekdays"],
          message: "errors.selectAtLeastOneWeekday",
        });

      if (
        data.endsMode === "after" &&
        (!data.endAfterOccurrences || data.endAfterOccurrences < 1)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endAfterOccurrences"],
          message: "errors.positiveInteger",
        });

      if (data.endsMode === "on" && data.endOnDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const end = new Date(data.endOnDate);
        end.setHours(0, 0, 0, 0);
        if (end < today)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endOnDate"],
            message: "errors.endDateInPast",
          });
      }

      if (data.endsMode === "on" && !data.endOnDate)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endOnDate"],
          message: "errors.required",
        });
    }
  });

const ENDS_OPTION_LABEL_CLASS = "min-w-16 shrink-0 whitespace-nowrap";

/** Calendar days from `from` to `to`, counted in `timezone`. */
function localDaysBetween(from: Date, to: Date, timezone: string): number {
  const day = (date: Date) =>
    Date.parse(`${utcToDateTimeLocalInTimezone(date, timezone).slice(0, 10)}Z`);
  return Math.round((day(to) - day(from)) / 86_400_000);
}

function getDefaultTime(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseTimeOrNow(
  value: string | undefined,
  now: Date,
): [number, number] {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  if (!m) return [now.getHours(), now.getMinutes()];
  return [Number(m[1]), Number(m[2])];
}

interface TaskScheduleSectionProps {
  initialSelection?: TaskScheduleSelection | null;
  onSave?: (selection: TaskScheduleSelection) => void;
  onCancel?: () => void;
  saveLabel?: string;
  /** Blocks saving for reasons outside the rule, such as a missing name. */
  saveDisabled?: boolean;
}

/** The rule of a Task Schedule, which always repeats. */
export function TaskScheduleSection(props: TaskScheduleSectionProps) {
  const t = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();
  const firstRunId = useId();
  const timeOfDayId = useId();
  const timezoneOptions = useMemo(
    () => getTimezoneOptions(props.initialSelection?.timezone),
    [props.initialSelection?.timezone],
  );
  const [scheduleOption, setScheduleOption] = useState<ScheduleOption>("daily");
  const [timezone, setTimezone] = useState<string>(
    props.initialSelection?.timezone ?? getDefaultTimezone(),
  );
  const [customCronExpr, setCustomCronExpr] = useState<string>(
    props.initialSelection?.customCronExpr ?? "",
  );
  const [firstRunLocalIso, setFirstRunLocalIso] = useState<string>(() =>
    formatDateTimeLocalInput(new Date(Date.now() + 5 * 60 * 1000)),
  );
  // Note: We derive cron expression from builder fields; no separate cron state needed
  // Recurrence builder state (for CRON UI)
  const [repeatEveryCount, setRepeatEveryCount] = useState<number>(1);
  const [repeatEveryUnit, setRepeatEveryUnit] = useState<
    "day" | "week" | "month"
  >("day");
  const [repeatWeekdays, setRepeatWeekdays] = useState<Dow[]>(["MON"]);
  const [endsMode, setEndsMode] = useState<TaskScheduleEndsMode>(
    TaskScheduleEndsMode.NEVER,
  );
  const [endOnDate, setEndOnDate] = useState<Date | undefined>(undefined);
  const [endAfterOccurrences, setEndAfterOccurrences] = useState<number>(13);
  const [timeOfDay, setTimeOfDay] = useState<string>(getDefaultTime());

  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isValid, setIsValid] = useState<boolean>(true);

  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  useEffect(() => {
    const formData = {
      scheduleOption,
      firstRunLocalIso,
      timeOfDay,
      repeatEveryCount,
      repeatEveryUnit,
      repeatWeekdays,
      endsMode,
      endOnDate,
      endAfterOccurrences,
    };

    const result = scheduleFormSchema.safeParse(formData);
    if (result.success) {
      if (
        scheduleOption === "custom" &&
        customCronExpr.trim() &&
        !isValidCronExpression(customCronExpr.trim(), timezone)
      ) {
        setErrors({ customCronExpr: "errors.invalidCron" });
        setIsValid(false);
        return;
      }

      setErrors({});
      setIsValid(true);
    } else {
      const fieldErrors: ValidationErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ValidationErrors | undefined;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      setIsValid(false);
    }
  }, [
    scheduleOption,
    firstRunLocalIso,
    timeOfDay,
    repeatEveryUnit,
    repeatEveryCount,
    repeatWeekdays,
    endsMode,
    endOnDate,
    endAfterOccurrences,
    customCronExpr,
    timezone,
  ]);

  const presetDisplayLabels = useMemo(() => {
    const base = {
      daily: t("option.daily"),
      weekly: t("option.weekly"),
      monthly: t("option.monthly"),
    };

    const parsed = parseDateTimeLocalInput(firstRunLocalIso);
    if (!parsed) return base;

    const timeLabel = formatter.dateTime(parsed, "time", {
      timeZone: timezone,
    });
    const weekdayLabel = formatter.dateTime(parsed, {
      weekday: "long",
      timeZone: timezone,
    });
    const dayOfMonth = parsed.getDate();

    return {
      daily: t("option.dailyWithTime", { time: timeLabel }),
      weekly: t("option.weeklyWithWeekdayTime", {
        weekday: weekdayLabel,
        time: timeLabel,
      }),
      monthly: t("option.monthlyWithDayTime", {
        day: dayOfMonth,
        time: timeLabel,
      }),
    };
  }, [formatter, firstRunLocalIso, t, timezone]);

  function deriveBuilderStateFromCron(cron: string): {
    unit: "day" | "week" | "month";
    count: number;
    weekdays: Dow[];
    hour: number;
    minute: number;
  } | null {
    // Format assumptions (from builder):
    // daily every N days:    "m h */N * *"
    // weekly weekdays list:  "m h * * MON,TUE"
    // monthly every N mons:  "m h DOM */N *"
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [mStr, hStr, dom, mon, dow] = parts;
    const minute = Number(mStr);
    const hour = Number(hStr);
    if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;

    // weekly pattern: "* * MON,TUE"
    if (dom === "*" && mon === "*" && /[A-Z,]+/.test(dow)) {
      const weekdays = dow.split(",").filter(Boolean) as Dow[];
      return { unit: "week", count: 1, weekdays, hour, minute };
    }

    // daily every N days: "*/N" in day-of-month position
    const dailyEvery = dom.startsWith("*/") ? Number(dom.slice(2)) : NaN;
    if (mon === "*" && dow === "*" && Number.isFinite(dailyEvery)) {
      return {
        unit: "day",
        count: Math.max(1, Number(dailyEvery)),
        weekdays: ["MON"],
        hour,
        minute,
      };
    }

    // monthly every N months: DOM fixed, month is "*/N"
    const monthlyEvery = mon.startsWith("*/") ? Number(mon.slice(2)) : NaN;
    const domNum = Number(dom);
    if (
      Number.isFinite(monthlyEvery) &&
      Number.isFinite(domNum) &&
      dow === "*"
    ) {
      // Note: builder uses today's DOM when creating; we keep unit/monthly and count
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

  // Hydrate state from initialSelection when provided
  useEffect(() => {
    const sel = props.initialSelection;
    if (!sel) return;

    setTimezone(sel.timezone);

    const cron = sel.customCronExpr?.trim() || sel.cron || "";
    if (sel.customCronExpr) {
      setCustomCronExpr(sel.customCronExpr);
    }
    // An every-N-days rule keeps its day step outside the cron, so its daily
    // cron must not read as the Daily preset, which would drop the step.
    const derivedPreset =
      sel.intervalDays != null && sel.intervalDays > 1
        ? null
        : derivePresetFromCron(cron);
    if (derivedPreset) {
      setScheduleOption(derivedPreset.option);
      setFirstRunLocalIso(derivedPreset.iso);
    } else if (sel.intervalDays != null && sel.intervalDays > 1) {
      // The builder carries an every-N-days rule: its step, and the anchor's
      // time as the time of day. A cron text would override the builder.
      setScheduleOption("custom");
      setCustomCronExpr("");
      setRepeatEveryUnit("day");
      setRepeatEveryCount(sel.intervalDays);
      if (sel.oneTimeLocalIso) {
        setFirstRunLocalIso(sel.oneTimeLocalIso);
        setTimeOfDay(sel.oneTimeLocalIso.slice(11, 16));
      }
    } else {
      setScheduleOption("custom");
      if (cron) setCustomCronExpr(cron);
      const derived = deriveBuilderStateFromCron(cron);
      if (derived) {
        setRepeatEveryUnit(derived.unit);
        setRepeatEveryCount(derived.count);
        if (derived.unit === "week") setRepeatWeekdays(derived.weekdays);
        setTimeOfDay(`${pad2(derived.hour)}:${pad2(derived.minute)}`);
      }
    }

    if (sel.endsMode) setEndsMode(sel.endsMode);
    if (sel.endOnLocalDate) {
      const [y, mo, d] = sel.endOnLocalDate.split("-").map((s) => Number(s));
      if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
        setEndOnDate(new Date(y, mo - 1, d));
      }
    } else {
      setEndOnDate(undefined);
    }
    if (sel.endAfterOccurrences) {
      setEndAfterOccurrences(Math.max(1, sel.endAfterOccurrences));
    }
  }, [props.initialSelection]);

  const buildCronFromSelections = useCallback((): string => {
    const now = new Date();
    const [hour, minute] = parseTimeOrNow(timeOfDay, now);
    if (repeatEveryUnit === "day") {
      return `${minute} ${hour} * * *`;
    }
    if (repeatEveryUnit === "week") {
      const fallbackDay: Dow = DOW[now.getDay() as number];
      const days = (
        repeatWeekdays.length ? repeatWeekdays : [fallbackDay]
      ).join(",");
      return `${minute} ${hour} * * ${days}`;
    }
    const dayOfMonth = now.getDate();
    return `${minute} ${hour} ${dayOfMonth} */${Math.max(1, repeatEveryCount)} *`;
  }, [repeatEveryUnit, repeatEveryCount, repeatWeekdays, timeOfDay]);

  const computedCron = useMemo(() => {
    if (scheduleOption !== "custom") return "";
    return buildCronFromSelections();
  }, [scheduleOption, buildCronFromSelections]);

  const getPresetCron = useCallback((): string | null => {
    const parts = parseDateTimeLocalParts(firstRunLocalIso);
    if (!parts) return null;

    const { hour, minute, day, month, year } = parts;

    if (scheduleOption === "daily") return `${minute} ${hour} * * *`;

    if (scheduleOption === "weekly") {
      const weekday = DOW[gregorianDayOfWeek(year, month, day) as number];
      return `${minute} ${hour} * * ${weekday}`;
    }

    if (scheduleOption === "monthly") {
      return `${minute} ${hour} ${day} * *`;
    }
    return null;
  }, [scheduleOption, firstRunLocalIso]);

  const getSelectedCron = useCallback((): string | null => {
    if (scheduleOption === "custom") {
      const trimmed = customCronExpr.trim();
      if (trimmed) return trimmed;
      return computedCron || buildCronFromSelections();
    }
    return getPresetCron();
  }, [
    scheduleOption,
    customCronExpr,
    computedCron,
    buildCronFromSelections,
    getPresetCron,
  ]);

  const everyNDays =
    scheduleOption === "custom" &&
    repeatEveryUnit === "day" &&
    repeatEveryCount > 1
      ? repeatEveryCount
      : null;
  const intervalAnchorLocalIso = `${firstRunLocalIso.slice(0, 10)}T${timeOfDay}`;

  const emitSelection = useCallback((): TaskScheduleSelection => {
    const cron = getSelectedCron() ?? undefined;

    return {
      mode: "recurring",
      timezone,
      // Core runs an every-N-days rule at its anchor's local time, so the
      // anchor takes the builder's time of day.
      oneTimeLocalIso: everyNDays ? intervalAnchorLocalIso : firstRunLocalIso,
      cron,
      customCronExpr: scheduleOption === "custom" ? customCronExpr : undefined,
      ...(everyNDays != null ? { intervalDays: everyNDays } : {}),
      endsMode,
      endOnLocalDate:
        endsMode === TaskScheduleEndsMode.ON && endOnDate
          ? `${endOnDate.getFullYear()}-${String(endOnDate.getMonth() + 1).padStart(2, "0")}-${String(endOnDate.getDate()).padStart(2, "0")}`
          : undefined,
      endAfterOccurrences:
        endsMode === TaskScheduleEndsMode.AFTER
          ? Math.max(1, endAfterOccurrences)
          : undefined,
    };
  }, [
    timezone,
    scheduleOption,
    firstRunLocalIso,
    customCronExpr,
    getSelectedCron,
    endsMode,
    endOnDate,
    endAfterOccurrences,
    everyNDays,
    intervalAnchorLocalIso,
  ]);

  const nextPreview = useMemo(() => {
    const cron = getSelectedCron();
    if (!cron) return [] as string[];
    try {
      const now = new Date();
      const anchor = everyNDays
        ? zonedDateTimeLocalToUtc(intervalAnchorLocalIso, timezone)
        : null;
      // An every-N-days rule starts at its anchor, then keeps every Nth of
      // the daily cron's days.
      const currentDate =
        anchor && anchor > now ? new Date(anchor.getTime() - 60_000) : now;
      const interval = cronParser.parse(cron, { currentDate, tz: timezone });
      const maxCount = Math.max(
        1,
        Math.min(
          3,
          endsMode === TaskScheduleEndsMode.AFTER ? endAfterOccurrences : 3,
        ),
      );
      const results: string[] = [];
      let safety = 20 + 3 * (everyNDays ?? 0);
      while (results.length < maxCount && safety > 0) {
        const nextDate = interval.next().toDate();
        safety--;
        if (endsMode === TaskScheduleEndsMode.ON && endOnDate) {
          if (nextDate > endOnDate) break;
        }
        if (
          everyNDays &&
          anchor &&
          localDaysBetween(anchor, nextDate, timezone) % everyNDays !== 0
        ) {
          continue;
        }
        results.push(
          formatter.dateTime(nextDate, "dateTimeMedium", {
            timeZone: timezone,
          }),
        );
      }
      return results;
    } catch {
      return [];
    }
  }, [
    formatter,
    timezone,
    endsMode,
    endOnDate,
    endAfterOccurrences,
    getSelectedCron,
    everyNDays,
    intervalAnchorLocalIso,
  ]);

  function handleSave() {
    const selection = emitSelection();
    if (!isValid) return;
    props.onSave?.(selection);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="space-y-2">
          <Label>{t("timezone")}</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("timezone")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezoneOptions.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {scheduleOption !== "custom" && (
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={firstRunId}>{t("firstRun")}</Label>
              <Input
                id={firstRunId}
                type="datetime-local"
                value={firstRunLocalIso}
                onChange={(e) => setFirstRunLocalIso(e.target.value)}
                aria-invalid={!!errors.firstRunLocalIso}
                min={formatDateTimeLocalInput(new Date())}
              />
              {errors.firstRunLocalIso ? (
                <p className="text-destructive mt-1 text-xs">
                  {t(errors.firstRunLocalIso)}
                </p>
              ) : null}
            </div>
          </div>
        )}
        <Select
          value={scheduleOption}
          onValueChange={(v) => setScheduleOption(v as ScheduleOption)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">{presetDisplayLabels.daily}</SelectItem>
            <SelectItem value="weekly">{presetDisplayLabels.weekly}</SelectItem>
            <SelectItem value="monthly">
              {presetDisplayLabels.monthly}
            </SelectItem>
            <SelectItem value="custom">{t("option.custom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {scheduleOption === "custom" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="text-base">{t("customCron")}</Label>
            <Input
              value={customCronExpr}
              onChange={(event) => setCustomCronExpr(event.target.value)}
              placeholder="0 9 * * *"
              aria-invalid={!!errors.customCronExpr}
            />
            {errors.customCronExpr ? (
              <p className="text-destructive text-xs">
                {t(errors.customCronExpr)}
              </p>
            ) : null}
            {customCronExpr.trim() &&
            isValidCronExpression(customCronExpr.trim(), timezone) ? (
              <p className="text-muted-foreground text-xs">
                {t("customCronValid")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 md:flex-row">
            {/* Repeat every */}
            <div className="w-full space-y-2">
              <Label className="text-base">{t("repeatEvery")}</Label>
              <div className="flex items-center gap-3">
                <Input
                  inputMode="numeric"
                  type="number"
                  min={1}
                  value={repeatEveryCount}
                  onChange={(e) =>
                    setRepeatEveryCount(Math.max(1, Number(e.target.value)))
                  }
                  className="w-24"
                  aria-invalid={!!errors.repeatEveryCount}
                />
                {errors.repeatEveryCount ? (
                  <p className="text-destructive mt-1 text-xs">
                    {t(errors.repeatEveryCount)}
                  </p>
                ) : null}
                <Select
                  value={repeatEveryUnit}
                  onValueChange={(v) =>
                    setRepeatEveryUnit(v as "day" | "week" | "month")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">{t("unit.day")}</SelectItem>
                    <SelectItem value="week">{t("unit.week")}</SelectItem>
                    <SelectItem value="month">{t("unit.month")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="w-full space-y-2">
              <Label htmlFor={timeOfDayId} className="text-base">
                {t("timeOfDay")}
              </Label>
              <Input
                id={timeOfDayId}
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-full"
                aria-invalid={!!errors.timeOfDay}
              />
              {errors.timeOfDay ? (
                <p className="text-destructive mt-1 text-xs">
                  {t(errors.timeOfDay)}
                </p>
              ) : null}
            </div>
          </div>

          {/* Repeat on (weekdays) */}
          {repeatEveryUnit === "week" && (
            <div className="space-y-2">
              <Label
                className={cn(
                  "text-base",
                  repeatEveryUnit !== "week" && "opacity-60",
                )}
              >
                {t("repeatOn")}
              </Label>
              <ToggleGroup
                type="multiple"
                variant="outline"
                value={repeatWeekdays}
                onValueChange={(value) =>
                  setRepeatWeekdays(value as typeof repeatWeekdays)
                }
                className="grid w-fit grid-cols-7 gap-2"
                disabled={repeatEveryUnit !== "week"}
              >
                {(
                  [
                    { v: "SUN", l: "S" },
                    { v: "MON", l: "M" },
                    { v: "TUE", l: "T" },
                    { v: "WED", l: "W" },
                    { v: "THU", l: "T" },
                    { v: "FRI", l: "F" },
                    { v: "SAT", l: "S" },
                  ] as const
                ).map((d) => (
                  <ToggleGroupItem
                    key={d.v}
                    value={d.v}
                    aria-label={d.v}
                    className="size-9"
                  >
                    {d.l}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {errors.repeatWeekdays ? (
                <p className="text-destructive mt-1 text-xs">
                  {t(errors.repeatWeekdays)}
                </p>
              ) : null}
            </div>
          )}

          {/* Ends */}
          <div className="space-y-3">
            <Label className="text-base">{t("ends")}</Label>
            <RadioGroup
              value={endsMode}
              onValueChange={(v) => setEndsMode(v as TaskScheduleEndsMode)}
              className="space-y-3"
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem
                  id="ends-never"
                  value={TaskScheduleEndsMode.NEVER}
                />
                <Label htmlFor="ends-never" className={ENDS_OPTION_LABEL_CLASS}>
                  {t("never")}
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem id="ends-on" value={TaskScheduleEndsMode.ON} />
                <Label htmlFor="ends-on" className={ENDS_OPTION_LABEL_CLASS}>
                  {t("on")}
                </Label>
                <div className="relative w-full">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        aria-invalid={!!errors.endOnDate}
                      >
                        {endOnDate
                          ? endOnDate.toLocaleDateString()
                          : t("pickDate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endOnDate}
                        onSelect={(d) => setEndOnDate(d ?? undefined)}
                        disabled={{ before: startOfToday }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                {errors.endOnDate ? (
                  <p className="text-destructive mt-1 text-xs">
                    {t(errors.endOnDate)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem
                  id="ends-after"
                  value={TaskScheduleEndsMode.AFTER}
                />
                <Label htmlFor="ends-after" className={ENDS_OPTION_LABEL_CLASS}>
                  {t("after")}
                </Label>
                <Input
                  inputMode="numeric"
                  type="number"
                  min={1}
                  value={endAfterOccurrences}
                  onChange={(e) =>
                    setEndAfterOccurrences(Math.max(1, Number(e.target.value)))
                  }
                  className="w-full"
                  aria-invalid={!!errors.endAfterOccurrences}
                />
                <span className="text-muted-foreground text-sm">
                  {t("occurrences")}
                </span>
                {errors.endAfterOccurrences ? (
                  <p className="text-destructive mt-1 text-xs">
                    {t(errors.endAfterOccurrences)}
                  </p>
                ) : null}
              </div>
            </RadioGroup>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label className="text-base">{t("preview")}</Label>
            <div
              className={cn(
                "rounded-md border p-3",
                nextPreview.length === 0 && "opacity-60",
              )}
            >
              {nextPreview.length > 0 ? (
                <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                  {nextPreview.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted-foreground text-sm">
                  {t("noPreview")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {scheduleOption !== "custom" && (
        <div className="space-y-2">
          <Label className="text-base">{t("preview")}</Label>
          <div
            className={cn(
              "rounded-md border p-3",
              nextPreview.length === 0 && "opacity-60",
            )}
          >
            {nextPreview.length > 0 ? (
              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                {nextPreview.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <div className="text-muted-foreground text-sm">
                {t("noPreview")}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            props.onCancel?.();
          }}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isValid || props.saveDisabled}
          aria-invalid={!isValid}
        >
          {props.saveLabel ?? t("save")}
        </Button>
      </div>
    </div>
  );
}
