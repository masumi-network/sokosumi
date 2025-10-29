import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
  type ScheduleTitleInfo,
} from "@/components/schedules/format";

describe("computeScheduleTitleInfo", () => {
  const timezone = "UTC";

  it("daily exact time", () => {
    const info = computeScheduleTitleInfo({
      scheduleType: "CRON",
      cron: "5 10 * * *",
      timezone,
    });
    expect(info.key).toBe("dailyWithTime");
  });

  it("daily every N days", () => {
    const info = computeScheduleTitleInfo({
      scheduleType: "CRON",
      cron: "0 9 */3 * *",
      timezone,
    });
    expect(info.key).toBe("dailyEveryNWithTime");
  });

  it("weekly multi DOW", () => {
    const info = computeScheduleTitleInfo({
      scheduleType: "CRON",
      cron: "0 16 * * MON,WED",
      timezone,
    });
    expect(info.key).toBe("weeklyListWithTime");
  });

  it("monthly every N months", () => {
    const info = computeScheduleTitleInfo({
      scheduleType: "CRON",
      cron: "0 8 10 */2 *",
      timezone,
    });
    expect(info.key).toBe("monthlyEveryNWithDayTime");
  });

  it("one-time", () => {
    const info = computeScheduleTitleInfo({
      scheduleType: "ONE_TIME",
      cron: null,
      timezone,
    });
    expect(info.key).toBe("oneTime");
  });
});

describe("formatScheduleTitle", () => {
  function createSpyT() {
    const calls: Array<{ key: string; values?: Record<string, unknown> }> = [];
    const t = (key: string, values?: Record<string, unknown>) => {
      calls.push({ key, values });
      return key; // return key for easy assertion
    };
    return { t, calls };
  }

  it("formats oneTime", () => {
    const { t, calls } = createSpyT();
    const title = formatScheduleTitle({ key: "oneTime" }, t);
    expect(title).toBe("option.oneTime");
    expect(calls[0]).toEqual({ key: "option.oneTime", values: undefined });
  });

  it("formats dailyWithTime with values", () => {
    const { t, calls } = createSpyT();
    const info: ScheduleTitleInfo = {
      key: "dailyWithTime",
      values: { time: "10:05" },
    };
    const title = formatScheduleTitle(info, t);
    expect(title).toBe("option.dailyWithTime");
    expect(calls[0]).toEqual({
      key: "option.dailyWithTime",
      values: { time: "10:05" },
    });
  });

  it("formats weeklyWithWeekdayTime with values", () => {
    const { t, calls } = createSpyT();
    const info: ScheduleTitleInfo = {
      key: "weeklyWithWeekdayTime",
      values: { weekday: "Monday", time: "09:00" },
    };
    const title = formatScheduleTitle(info, t);
    expect(title).toBe("option.weeklyWithWeekdayTime");
    expect(calls[0]).toEqual({
      key: "option.weeklyWithWeekdayTime",
      values: { weekday: "Monday", time: "09:00" },
    });
  });
});
