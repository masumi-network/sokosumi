import {
  type DateTimeFormatter,
  formatTime,
  formatWeekday,
  parseCron,
} from "@/lib/schedules/cron";

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
  formatter: DateTimeFormatter,
): ScheduleTitleInfo {
  if (s.scheduleType === "ONE_TIME") return { key: "oneTime" };

  const parsed = parseCron(s.cron ?? "");

  switch (parsed.kind) {
    case "dailyAtTime": {
      const time = formatTime(
        parsed.hour,
        parsed.minute,
        formatter,
        s.timezone,
      );
      return { key: "dailyWithTime", values: { time } };
    }
    case "weeklyAtTime": {
      const time = formatTime(
        parsed.hour,
        parsed.minute,
        formatter,
        s.timezone,
      );
      if (parsed.dows.length === 1) {
        const weekday = formatWeekday(parsed.dows[0], formatter, s.timezone);
        return { key: "weeklyWithWeekdayTime", values: { weekday, time } };
      }
      const weekdays = parsed.dows.join(",");
      return { key: "weeklyListWithTime", values: { weekdays, time } };
    }
    case "monthlyOnDay": {
      const time = formatTime(
        parsed.hour,
        parsed.minute,
        formatter,
        s.timezone,
      );
      return {
        key: "monthlyWithDayTime",
        values: { day: parsed.dayOfMonth, time },
      };
    }
    case "dailyEveryN": {
      const time = formatTime(
        parsed.hour,
        parsed.minute,
        formatter,
        s.timezone,
      );
      return {
        key: "dailyEveryNWithTime",
        values: { n: parsed.everyNDays, time },
      };
    }
    case "monthlyEveryN": {
      const time = formatTime(
        parsed.hour,
        parsed.minute,
        formatter,
        s.timezone,
      );
      return {
        key: "monthlyEveryNWithDayTime",
        values: { n: parsed.everyNMonths, day: parsed.dayOfMonth, time },
      };
    }
    default:
      return { key: "custom" };
  }
}

/** The `App.Tasks.Schedule` keys {@link formatScheduleTitle} can ask for. */
export type ScheduleTitleTranslationKey = `option.${ScheduleTitleInfo["key"]}`;

/**
 * Narrow enough that a next-intl translator satisfies it directly, so callers
 * do not have to widen their key type with a cast.
 */
export type ScheduleTitleTranslateFn = (
  key: ScheduleTitleTranslationKey,
  values?: Record<string, string | number | Date>,
) => string;

export function formatScheduleTitle(
  info: ScheduleTitleInfo,
  t: ScheduleTitleTranslateFn,
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
