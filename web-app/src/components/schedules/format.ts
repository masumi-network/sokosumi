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

  const cron = (s.cron ?? "").trim();

  // daily exact time: m h * * *
  let m = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/.exec(cron);
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    }).format(base);
    return { key: "dailyWithTime", values: { time } };
  }

  // weekly single weekday: m h * * DOW
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* ([A-Z]{3})$/.exec(cron);
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    }).format(base);
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      timeZone: s.timezone,
    }).format(base);
    return { key: "weeklyWithWeekdayTime", values: { weekday, time } };
  }

  // monthly fixed DOM: m h D * *
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) ([0-2]?\d|3[01]) \* \*$/.exec(cron);
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const day = Number(m[3]);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    }).format(base);
    return { key: "monthlyWithDayTime", values: { day, time } };
  }

  // daily every N days: m h */N * *
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) \*\/([1-9]\d*) \* \*$/.exec(cron);
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const n = Number(m[3]);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    }).format(base);
    return { key: "dailyEveryNWithTime", values: { n, time } };
  }

  // weekly multi DOW list: m h * * MON,TUE
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) \* \* ([A-Z]{3}(?:,[A-Z]{3})+)$/.exec(cron);
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    }).format(base);
    const weekdays = m[3];
    return { key: "weeklyListWithTime", values: { weekdays, time } };
  }

  // monthly every N months on day D: m h D */N *
  m = /^([0-5]?\d) ([01]?\d|2[0-3]) ([0-2]?\d|3[01]) \*\/([1-9]\d*) \*$/.exec(
    cron,
  );
  if (m) {
    const hour = Number(m[2]);
    const minute = Number(m[1]);
    const day = Number(m[3]);
    const n = Number(m[4]);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timezone,
    }).format(base);
    return { key: "monthlyEveryNWithDayTime", values: { n, day, time } };
  }

  return { key: "custom" };
}

export type TranslateFn = (
  key: string,
  values?: Record<string, unknown>,
) => string;

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
