import { describe, expect, it } from "vitest";

import { isOverdueMomentDue } from "./task-interest-clock";

const dueOn = new Date("2026-11-16T00:00:00.000Z");

describe("isOverdueMomentDue", () => {
  it("fires from 09:00 local on the first day after the due date", () => {
    // 07:59 UTC is 08:59 in Berlin, 08:00 UTC is 09:00.
    expect(
      isOverdueMomentDue(
        dueOn,
        new Date("2026-11-17T07:59:00.000Z"),
        "Europe/Berlin",
      ),
    ).toBe(false);
    expect(
      isOverdueMomentDue(
        dueOn,
        new Date("2026-11-17T08:00:00.000Z"),
        "Europe/Berlin",
      ),
    ).toBe(true);
  });

  it("uses the local day, not the UTC day", () => {
    // 2026-11-17 22:00 UTC is already 2026-11-18 in Tokyo: a missed day.
    expect(
      isOverdueMomentDue(
        dueOn,
        new Date("2026-11-17T22:00:00.000Z"),
        "Asia/Tokyo",
      ),
    ).toBe(false);
    // 2026-11-18 03:00 UTC is still 2026-11-17 22:00 in New York.
    expect(
      isOverdueMomentDue(
        dueOn,
        new Date("2026-11-18T03:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe(true);
  });

  it("sends nothing on the due day or two days after", () => {
    expect(
      isOverdueMomentDue(dueOn, new Date("2026-11-16T12:00:00.000Z"), "UTC"),
    ).toBe(false);
    expect(
      isOverdueMomentDue(dueOn, new Date("2026-11-18T12:00:00.000Z"), "UTC"),
    ).toBe(false);
  });

  it("falls back to Berlin for a zone the runtime does not know", () => {
    expect(
      isOverdueMomentDue(
        dueOn,
        new Date("2026-11-17T08:00:00.000Z"),
        "Not/AZone",
      ),
    ).toBe(true);
  });
});
