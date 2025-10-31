"use client";

import { CronExpressionParser as cronParser } from "cron-parser";
import { PlayCircle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Dow,
  parseCron,
} from "@/lib/schedules/cron";
import {
  JobScheduleEndsMode,
  JobScheduleSelectionType,
  JobScheduleType,
} from "@/lib/types/job";
import { cn } from "@/lib/utils";

type ScheduleOption = "one-time" | "daily" | "weekly" | "monthly" | "custom";

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
  option: Exclude<ScheduleOption, "one-time" | "custom">;
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
  oneTimeLocalIso?: string;
  timeOfDay?: string;
  repeatEveryCount?: string;
  repeatWeekdays?: string;
  endOnDate?: string;
  endAfterOccurrences?: string;
};

const scheduleFormSchema = z
  .object({
    modeSelection: z.enum(["now", "recurring"]),
    scheduleOption: z.enum([
      "one-time",
      "daily",
      "weekly",
      "monthly",
      "custom",
    ]),
    oneTimeLocalIso: z.string().optional(),
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

    // One-time & presets must be future
    if (
      data.modeSelection === "recurring" &&
      data.scheduleOption !== "custom"
    ) {
      const dt = parseLocalIso(data.oneTimeLocalIso);
      if (!dt)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["oneTimeLocalIso"],
          message: "errors.required",
        });
      else if (dt <= now)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["oneTimeLocalIso"],
          message: "errors.futureDateTime",
        });
    }

    // Custom builder rules
    if (
      data.modeSelection === "recurring" &&
      data.scheduleOption === "custom"
    ) {
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

interface Props {
  timezoneOptions: string[];
  initialSelection?: JobScheduleSelectionType | null;
  onSave: (selection: JobScheduleSelectionType) => void;
  onCancel: () => void;
}

export function JobScheduleSection(props: Props) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Scheduler");
  const [mode, setMode] = useState<JobScheduleType>(JobScheduleType.NOW);
  const [modeSelection, setModeSelection] = useState<"now" | "recurring">(
    "now",
  );
  const [scheduleOption, setScheduleOption] =
    useState<ScheduleOption>("one-time");
  const [timezone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [oneTimeLocalIso, setOneTimeLocalIso] = useState<string>(() =>
    formatDateTimeLocalInput(new Date(Date.now() + 5 * 60 * 1000)),
  );
  // Note: We derive cron expression from builder fields; no separate cron state needed
  // Recurrence builder state (for CRON UI)
  const [repeatEveryCount, setRepeatEveryCount] = useState<number>(1);
  const [repeatEveryUnit, setRepeatEveryUnit] = useState<
    "day" | "week" | "month"
  >("day");
  const [repeatWeekdays, setRepeatWeekdays] = useState<Dow[]>(["MON"]);
  const [endsMode, setEndsMode] = useState<JobScheduleEndsMode>(
    JobScheduleEndsMode.NEVER,
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
      modeSelection,
      scheduleOption,
      oneTimeLocalIso,
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
    modeSelection,
    scheduleOption,
    oneTimeLocalIso,
    timeOfDay,
    repeatEveryUnit,
    repeatEveryCount,
    repeatWeekdays,
    endsMode,
    endOnDate,
    endAfterOccurrences,
  ]);

  const presetDisplayLabels = useMemo(() => {
    const base = {
      daily: t("option.daily"),
      weekly: t("option.weekly"),
      monthly: t("option.monthly"),
    };

    const parsed = parseDateTimeLocalInput(oneTimeLocalIso);
    if (!parsed) return base;

    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
    const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      timeZone: timezone,
    });

    const timeLabel = timeFormatter.format(parsed);
    const weekdayLabel = weekdayFormatter.format(parsed);
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
  }, [oneTimeLocalIso, t, timezone]);

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

    // Mode and option
    if (sel.mode === JobScheduleType.NOW) {
      setMode(JobScheduleType.NOW);
      setModeSelection("now");
      setScheduleOption("one-time");
      return;
    }

    if (sel.mode === JobScheduleType.ONE_TIME) {
      setMode(JobScheduleType.ONE_TIME);
      setModeSelection("recurring");
      setScheduleOption("one-time");
      if (sel.oneTimeLocalIso) setOneTimeLocalIso(sel.oneTimeLocalIso);
      return;
    }

    // CRON
    setMode(JobScheduleType.CRON);
    setModeSelection("recurring");
    const cron = sel.cron ?? "";
    const derivedPreset = derivePresetFromCron(cron);
    if (derivedPreset) {
      setScheduleOption(derivedPreset.option);
      setOneTimeLocalIso(derivedPreset.iso);
    } else {
      setScheduleOption("custom");
      const derived = deriveBuilderStateFromCron(cron);
      if (derived) {
        setRepeatEveryUnit(derived.unit);
        setRepeatEveryCount(derived.count);
        if (derived.unit === "week") setRepeatWeekdays(derived.weekdays);
        setTimeOfDay(`${pad2(derived.hour)}:${pad2(derived.minute)}`);
      }
    }

    // Ends
    if (sel.endsMode) setEndsMode(sel.endsMode);
    if (sel.endOnLocalDate) {
      const [y, mo, d] = sel.endOnLocalDate.split("-").map((s) => Number(s));
      if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
        setEndOnDate(new Date(y, mo - 1, d));
      }
    } else {
      setEndOnDate(undefined);
    }
    if (sel.endAfterOccurrences)
      setEndAfterOccurrences(Math.max(1, sel.endAfterOccurrences));
  }, [props.initialSelection]);

  const buildCronFromSelections = useCallback((): string => {
    const now = new Date();
    const [hour, minute] = parseTimeOrNow(timeOfDay, now);
    if (repeatEveryUnit === "day") {
      return `${minute} ${hour} */${Math.max(1, repeatEveryCount)} * *`;
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
    if (mode !== JobScheduleType.CRON) return "";
    if (scheduleOption !== "custom") return "";
    return buildCronFromSelections();
  }, [mode, scheduleOption, buildCronFromSelections]);

  const getPresetCron = useCallback((): string | null => {
    const parsedDate = parseDateTimeLocalInput(oneTimeLocalIso) ?? new Date();
    const minute = parsedDate.getMinutes();
    const hour = parsedDate.getHours();

    if (scheduleOption === "daily") return `${minute} ${hour} * * *`;

    if (scheduleOption === "weekly") {
      const weekday = DOW[parsedDate.getDay() as number];
      return `${minute} ${hour} * * ${weekday}`;
    }

    if (scheduleOption === "monthly") {
      const dayOfMonth = parsedDate.getDate();
      return `${minute} ${hour} ${dayOfMonth} * *`;
    }
    return null;
  }, [scheduleOption, oneTimeLocalIso]);

  const getSelectedCron = useCallback((): string | null => {
    if (scheduleOption === "custom")
      return computedCron || buildCronFromSelections();
    return getPresetCron();
  }, [scheduleOption, computedCron, buildCronFromSelections, getPresetCron]);

  const nextPreview = useMemo(() => {
    if (mode !== JobScheduleType.CRON) return [] as string[];
    const cron = getSelectedCron();
    if (!cron) return [] as string[];
    try {
      const options = { currentDate: new Date(), tz: timezone } as const;
      const interval = cronParser.parse(cron, options);
      const maxCount = Math.max(
        1,
        Math.min(
          3,
          endsMode === JobScheduleEndsMode.AFTER ? endAfterOccurrences : 3,
        ),
      );
      const results: string[] = [];
      let safety = 20;
      while (results.length < maxCount && safety > 0) {
        const nextDate = interval.next().toDate();
        if (endsMode === JobScheduleEndsMode.ON && endOnDate) {
          if (nextDate > endOnDate) break;
        }
        results.push(
          nextDate.toLocaleString(undefined, { timeZone: timezone }),
        );
        safety--;
      }
      return results;
    } catch {
      return [];
    }
  }, [
    timezone,
    mode,
    endsMode,
    endOnDate,
    endAfterOccurrences,
    getSelectedCron,
  ]);

  function handleSave() {
    if (!isValid) return;
    if (mode === JobScheduleType.CRON) {
      const cronExpression = getSelectedCron();
      if (!cronExpression) {
        // Fallback to builder
        const fallback = buildCronFromSelections();
        props.onSave({
          mode: JobScheduleType.CRON,
          timezone,
          cron: fallback,
          endsMode,
          endOnLocalDate:
            endsMode === JobScheduleEndsMode.ON && endOnDate
              ? `${endOnDate.getFullYear()}-${String(endOnDate.getMonth() + 1).padStart(2, "0")}-${String(endOnDate.getDate()).padStart(2, "0")}`
              : undefined,
          endAfterOccurrences:
            endsMode === JobScheduleEndsMode.AFTER
              ? Math.max(1, endAfterOccurrences)
              : undefined,
        });
        return;
      }
      props.onSave({
        mode: JobScheduleType.CRON,
        timezone,
        cron: cronExpression,
        // For presets we do not expose Ends UI; keep defaults unless custom
        ...(scheduleOption === "custom"
          ? {
              endsMode,
              endOnLocalDate:
                endsMode === JobScheduleEndsMode.ON && endOnDate
                  ? `${endOnDate.getFullYear()}-${String(endOnDate.getMonth() + 1).padStart(2, "0")}-${String(endOnDate.getDate()).padStart(2, "0")}`
                  : undefined,
              endAfterOccurrences:
                endsMode === JobScheduleEndsMode.AFTER
                  ? Math.max(1, endAfterOccurrences)
                  : undefined,
            }
          : {}),
      });
      return;
    }
    if (mode === JobScheduleType.ONE_TIME) {
      props.onSave({
        mode: JobScheduleType.ONE_TIME,
        timezone,
        oneTimeLocalIso,
      });
      return;
    }
    props.onSave({ mode: JobScheduleType.NOW, timezone });
  }

  function handleScheduleOptionChange(next: ScheduleOption) {
    setScheduleOption(next);
    if (next === "one-time") {
      setMode(JobScheduleType.ONE_TIME);
      return;
    }
    setMode(JobScheduleType.CRON);
  }

  function handleModeSelectionChange(next: "now" | "recurring") {
    setModeSelection(next);
    if (next === "now") {
      setMode(JobScheduleType.NOW);
      return;
    }
    handleScheduleOptionChange(scheduleOption);
  }

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="space-y-2">
        <div className="mb-4 flex flex-col gap-2">
          <h1 className="text-xl font-light">{t("title")}</h1>
          <p className="text-muted-foreground text-xs">{t("description")}</p>
        </div>
        <RadioGroup
          value={modeSelection}
          onValueChange={(value) =>
            handleModeSelectionChange(value as "now" | "recurring")
          }
          className="grid gap-2 md:grid-cols-2"
        >
          <Label
            htmlFor="schedule-mode-now"
            className={cn(
              "hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md border p-4 transition-all",
              {
                "border-primary ring-primary ring-1": modeSelection === "now",
              },
            )}
          >
            <div className="flex w-full items-start gap-3">
              <PlayCircle className="size-6" />
              <div className="flex-1 space-y-1">
                <p className="text-sm">{t("modeCards.now.title")}</p>
                <p className="text-muted-foreground text-xs">
                  {t("modeCards.now.description")}
                </p>
              </div>
              <RadioGroupItem
                id="schedule-mode-now"
                value="now"
                className="mt-1"
              />
            </div>
          </Label>
          <Label
            htmlFor="schedule-mode-recurring"
            className={cn(
              "hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md border p-4 transition-all",
              {
                "border-primary ring-primary ring-1":
                  modeSelection === "recurring",
              },
            )}
          >
            <div className="flex w-full items-start gap-3">
              <RefreshCw className="size-6" />
              <div className="flex-1 space-y-1">
                <p className="text-sm">{t("modeCards.recurring.title")}</p>
                <p className="text-muted-foreground text-xs">
                  {t("modeCards.recurring.description")}
                </p>
              </div>
              <RadioGroupItem
                id="schedule-mode-recurring"
                value="recurring"
                className="mt-1"
              />
            </div>
          </Label>
        </RadioGroup>
      </div>
      {modeSelection === "recurring" && (
        <div className="space-y-2">
          {scheduleOption !== "custom" && (
            <div className="mb-4 space-y-3">
              <div className="flex flex-col gap-2">
                <Label>{t("pickDateTime")}</Label>
                <Input
                  type="datetime-local"
                  value={oneTimeLocalIso}
                  onChange={(e) => setOneTimeLocalIso(e.target.value)}
                  aria-invalid={!!errors.oneTimeLocalIso}
                  min={formatDateTimeLocalInput(new Date())}
                />
                {errors.oneTimeLocalIso ? (
                  <p className="text-destructive mt-1 text-xs">
                    {t(errors.oneTimeLocalIso)}
                  </p>
                ) : null}
              </div>
            </div>
          )}
          <Select
            value={scheduleOption}
            onValueChange={(v) => {
              const next = v as ScheduleOption;
              handleScheduleOptionChange(next);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one-time">{t("option.oneTime")}</SelectItem>
              <SelectItem value="daily">{presetDisplayLabels.daily}</SelectItem>
              <SelectItem value="weekly">
                {presetDisplayLabels.weekly}
              </SelectItem>
              <SelectItem value="monthly">
                {presetDisplayLabels.monthly}
              </SelectItem>
              <SelectItem value="custom">{t("option.custom")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {mode === JobScheduleType.CRON && scheduleOption === "custom" && (
        <div className="space-y-6">
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
            {/* Time of day */}
            <div className="w-full space-y-2">
              <Label className="text-base">{t("timeOfDay")}</Label>
              <Input
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
              onValueChange={(v) => setEndsMode(v as JobScheduleEndsMode)}
              className="space-y-3"
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem
                  id="ends-never"
                  value={JobScheduleEndsMode.NEVER}
                />
                <Label htmlFor="ends-never">{t("never")}</Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem id="ends-on" value={JobScheduleEndsMode.ON} />
                <Label htmlFor="ends-on" className="mr-2 min-w-10">
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
                  value={JobScheduleEndsMode.AFTER}
                />
                <Label htmlFor="ends-after" className="mr-2 min-w-10">
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
      {mode === JobScheduleType.CRON && scheduleOption !== "custom" && (
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
      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            props.onCancel();
          }}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isValid}
          aria-invalid={!isValid}
        >
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
