import { describe, expect, it } from "vitest";

import { scheduleSlotsOf } from "./social-post-schedule-picker";

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
