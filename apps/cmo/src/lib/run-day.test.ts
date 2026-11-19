import { expect, it } from "vitest";

import { runDay } from "./run-day";

// The weekly audit runs Monday 06:00 UTC: Sunday evening in Los Angeles.
const AUDIT = "2026-11-23T06:00:00Z";

it("words a run on the clock Cuso works on, with its time", () => {
  expect(runDay(AUDIT, "Europe/Zurich")).toBe("Monday 23 November at 07:00");
  expect(runDay(AUDIT, "America/Los_Angeles")).toBe(
    "Sunday 22 November at 22:00",
  );
});

it("leaves the time out for a day alone", () => {
  expect(runDay(AUDIT, "Europe/Zurich", { time: false })).toBe(
    "Monday 23 November",
  );
});
