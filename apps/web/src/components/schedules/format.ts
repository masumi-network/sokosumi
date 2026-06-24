import { formatTime, parseCron } from "@/lib/schedules/cron";
import { zonedDateTimeLocalToUtc } from "@/lib/schedules/zoned-datetime";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

export type ScheduleTitleInfo =
  | { key: "oneTime" }
  | { key: "custom" }
  | { key: "dailyWithTime"; values: { time: string } }
  | { key: "weeklyWithWeekdayTime"; values: { weekday: string; time: string } }
  | { key: "monthlyWithDayTime"; values: { day: number; time: string } }
  | { key: "dailyEveryNWithTime"; values: { n: number; time: string } }
  | { key: "weeklyListWithTime"; values: { weekdays: string; time: string } }
  | {
      key: "monthlyEveryNWithDayTime";
      values: { n: number; day: number; time: string };
    };

export interface ScheduleTitleInput {
  scheduleType: string;
  cron?: string | null;
  timezone: string;
}

export function computeScheduleTitleInfo(
  s: ScheduleTitleInput,
): ScheduleTitleInfo {
  if (s.scheduleType === "ONE_TIME") return { key: "oneTime" };

  const parsed = parseCron(s.cron ?? "");

  switch (parsed.kind) {
    case "dailyAtTime": {
      const time = formatTime(parsed.hour, parsed.minute, s.timezone);
      return { key: "dailyWithTime", values: { time } };
    }
    case "weeklyAtTime": {
      const time = formatTime(parsed.hour, parsed.minute, s.timezone);
      if (parsed.dows.length === 1) {
        // Keep parity: compute weekday label from a base date at that time
        const base = new Date();
        base.setHours(parsed.hour, parsed.minute, 0, 0);
        const weekday = new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          timeZone: s.timezone,
        }).format(base);
        return { key: "weeklyWithWeekdayTime", values: { weekday, time } };
      }
      const weekdays = parsed.dows.join(",");
      return { key: "weeklyListWithTime", values: { weekdays, time } };
    }
    case "monthlyOnDay": {
      const time = formatTime(parsed.hour, parsed.minute, s.timezone);
      return {
        key: "monthlyWithDayTime",
        values: { day: parsed.dayOfMonth, time },
      };
    }
    case "dailyEveryN": {
      const time = formatTime(parsed.hour, parsed.minute, s.timezone);
      return {
        key: "dailyEveryNWithTime",
        values: { n: parsed.everyNDays, time },
      };
    }
    case "monthlyEveryN": {
      const time = formatTime(parsed.hour, parsed.minute, s.timezone);
      return {
        key: "monthlyEveryNWithDayTime",
        values: { n: parsed.everyNMonths, day: parsed.dayOfMonth, time },
      };
    }
    default:
      return { key: "custom" };
  }
}

export type TranslateFn = (
  key: string,
  values?: Record<string, unknown>,
) => string;

type TaskScheduleDateTimeFormatOptions = {
  month?: "short";
  day?: "numeric";
  hour?: "numeric";
  minute?: "2-digit";
  timeZone?: string;
};

export type DateTimeFormatter = {
  dateTime: (
    value: Date,
    options?: TaskScheduleDateTimeFormatOptions,
  ) => string;
};

export function formatTaskScheduleSelectionLabel(
  selection: TaskScheduleSelection,
  t: TranslateFn,
  formatter: DateTimeFormatter,
): string | null {
  if (selection.mode === "none") return null;

  if (selection.mode === "once") {
    const runAt = zonedDateTimeLocalToUtc(
      selection.oneTimeLocalIso,
      selection.timezone,
    );
    if (!runAt) return t("option.oneTime");

    return t("footer.oneTimeAt", {
      datetime: formatter.dateTime(runAt, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: selection.timezone,
      }),
    });
  }

  const cron =
    selection.customCronExpr?.trim() || selection.cron?.trim() || null;
  if (!cron) return t("option.custom");

  return formatScheduleTitle(
    computeScheduleTitleInfo({
      scheduleType: "CRON",
      cron,
      timezone: selection.timezone,
    }),
    t,
  );
}

export function formatScheduleTitle(
  info: ScheduleTitleInfo,
  t: TranslateFn,
): string {
  switch (info.key) {
    case "oneTime":
      return t("option.oneTime");
    case "custom":
      return t("option.custom");
    case "dailyWithTime":
      return t("option.dailyWithTime", info.values);
    case "weeklyWithWeekdayTime":
      return t("option.weeklyWithWeekdayTime", info.values);
    case "monthlyWithDayTime":
      return t("option.monthlyWithDayTime", info.values);
    case "dailyEveryNWithTime":
      return t("option.dailyEveryNWithTime", info.values);
    case "weeklyListWithTime":
      return t("option.weeklyListWithTime", info.values);
    case "monthlyEveryNWithDayTime":
      return t("option.monthlyEveryNWithDayTime", info.values);
    default:
      return t("option.custom");
  }
}
