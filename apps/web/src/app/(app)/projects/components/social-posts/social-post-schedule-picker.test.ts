import { addMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  scheduleQuickPicks,
  scheduleSlotsOf,
  toScheduleValue,
} from "./social-post-schedule-picker";

/**
 * Daylight-saving days in the zone the suite runs in. In UTC they are
 * ordinary days, and the checks below hold for any zone.
 */
const DAYS = [
  new Date(2026, 2, 29), // Europe springs forward
  new Date(2026, 9, 25), // Europe falls back
  new Date(2026, 2, 8), // US springs forward
  new Date(2026, 10, 1), // US falls back
  new Date(2026, 5, 15),
];

describe("scheduleSlotsOf", () => {
  it.each(DAYS)("lists %s by wall clock, from midnight to 23:45", (day) => {
    const slots = scheduleSlotsOf(day);

    expect(slots.every((slot) => slot.getDate() === day.getDate())).toBe(true);
    expect(slots.every((slot) => slot.getMinutes() % 15 === 0)).toBe(true);
    const labels = slots.map(
      (slot) =>
        `${slot.getHours()}:${String(slot.getMinutes()).padStart(2, "0")}`,
    );
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toBe("0:00");
    expect(labels.at(-1)).toBe("23:45");
    // 96 slots, less the four a skipped hour takes.
    expect(slots.length === 96 || slots.length === 92).toBe(true);
  });
});

describe("toScheduleValue", () => {
  it("writes a local yyyy-MM-ddTHH:mm the picker can parse back", () => {
    const date = new Date(2026, 8, 21, 14, 30, 45, 123);
    expect(toScheduleValue(date)).toBe("2026-09-21T14:30");
    expect(new Date(toScheduleValue(date))).toEqual(
      new Date(2026, 8, 21, 14, 30),
    );
  });
});

describe("scheduleQuickPicks", () => {
  it("rounds in-an-hour up to the next 15-minute slot", () => {
    const now = new Date(2026, 5, 15, 8, 50, 1);
    const picks = scheduleQuickPicks(now);

    expect(picks.inAnHour).toEqual(new Date(2026, 5, 15, 10, 0));
    expect(picks.inAnHour.getTime()).toBeGreaterThanOrEqual(
      addMinutes(now, 60).getTime(),
    );
    expect(picks.inAnHour.getMinutes() % 15).toBe(0);
  });

  it("keeps an in-an-hour time that already sits on a slot", () => {
    const now = new Date(2026, 5, 15, 9, 0, 0);
    expect(scheduleQuickPicks(now).inAnHour).toEqual(
      new Date(2026, 5, 15, 10, 0),
    );
  });

  it("offers tomorrow and next Monday at 09:00 local", () => {
    const sunday = new Date(2026, 5, 14, 22, 15);
    const picks = scheduleQuickPicks(sunday);

    expect(picks.tomorrowMorning).toEqual(new Date(2026, 5, 15, 9, 0));
    expect(picks.nextMonday).toEqual(new Date(2026, 5, 15, 9, 0));
    expect(picks.tomorrowMorning.getHours()).toBe(9);
    expect(picks.nextMonday.getDay()).toBe(1);
  });

  it("does not pick this Monday when today is already Monday", () => {
    const monday = new Date(2026, 5, 15, 11, 0);
    const picks = scheduleQuickPicks(monday);

    expect(picks.nextMonday).toEqual(new Date(2026, 5, 22, 9, 0));
    expect(picks.tomorrowMorning).toEqual(new Date(2026, 5, 16, 9, 0));
  });
});
