import { describe, expect, it } from "vitest";

import { impactWindow, impactWindowReadyOn } from "@/lib/seo/impact-window";

// 2026-03-10T06:30Z is 23:30 on 2026-03-09 in Pacific daylight time (UTC-7).
const CHANGED_AT = new Date("2026-03-10T06:30:00Z");

describe("impactWindow", () => {
  it("dates the change and the crawl by the Pacific day, not the UTC day", () => {
    // The crawl is 2026-03-15 Pacific (6 days after the change day), 2026-03-16 UTC.
    expect(impactWindow(CHANGED_AT, new Date("2026-03-16T05:00:00Z"))).toEqual({
      windowStart: "2026-03-16",
      windowEnd: "2026-04-12",
    });
  });

  it("starts a week after the change day when Google crawls on the change day", () => {
    expect(impactWindow(CHANGED_AT, new Date("2026-03-10T06:45:00Z"))).toEqual({
      windowStart: "2026-03-16",
      windowEnd: "2026-04-12",
    });
  });

  it("starts after the crawl day when the crawl falls on the change day's weekday", () => {
    // 2026-03-16 Pacific is exactly one week after the change day.
    expect(impactWindow(CHANGED_AT, new Date("2026-03-16T18:00:00Z"))).toEqual({
      windowStart: "2026-03-23",
      windowEnd: "2026-04-19",
    });
  });

  it("uses the Pacific day across the change to standard time", () => {
    // The change is 23:30 PDT on 2026-10-31. The crawl is 23:30 PST (UTC-8) on
    // 2026-11-06, six days later; a fixed UTC-7 offset reads it as 2026-11-07.
    expect(
      impactWindow(
        new Date("2026-11-01T06:30:00Z"),
        new Date("2026-11-07T07:30:00Z"),
      ),
    ).toEqual({ windowStart: "2026-11-07", windowEnd: "2026-12-04" });
  });
});

describe("impactWindowReadyOn", () => {
  it("is the day Search Console data for the window's last day is final", () => {
    expect(impactWindowReadyOn("2026-04-12")).toBe("2026-04-19");
    expect(impactWindowReadyOn("2026-12-28")).toBe("2027-01-04");
  });
});
