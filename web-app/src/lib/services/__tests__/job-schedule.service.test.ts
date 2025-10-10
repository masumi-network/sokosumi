import { computeNextRun } from "@/lib/services/job-schedule.cron";

jest.mock("p-limit", () => ({
  __esModule: true,
  default: () => () => Promise.resolve(),
}));
jest.mock("@sentry/nextjs", () => ({
  __esModule: true,
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
// No additional mocks needed when importing the pure cron module

describe("computeNextRun", () => {
  // Fixed reference time to make tests deterministic
  // Using a Monday: 2025-10-06T13:30:00Z
  const from = new Date("2025-10-06T13:30:00.000Z");

  it("returns next run for '0 14 */1 * *' in UTC", () => {
    const next = computeNextRun({
      cron: "0 14 */1 * *",
      timezone: "UTC",
      from,
    });
    expect(next).not.toBeNull();
    // Next 14:00 UTC after 13:30 is the same day at 14:00
    expect(next?.toISOString()).toBe("2025-10-06T14:00:00.000Z");
  });

  it("returns next run for '28 16 * * MON,WED' in UTC when today is Monday before time", () => {
    const next = computeNextRun({
      cron: "28 16 * * MON,WED",
      timezone: "UTC",
      from,
    });
    expect(next).not.toBeNull();
    // Monday at 16:28 UTC on the same day
    expect(next?.toISOString()).toBe("2025-10-06T16:28:00.000Z");
  });

  it("rolls to next matching weekday when past today's time", () => {
    // After Monday 17:00 UTC, next should be Wednesday 16:28 UTC
    const afterMonday = new Date("2025-10-06T17:00:00.000Z");
    const next = computeNextRun({
      cron: "28 16 * * MON,WED",
      timezone: "UTC",
      from: afterMonday,
    });
    expect(next?.toISOString()).toBe("2025-10-08T16:28:00.000Z");
  });

  it("respects timezone when computing next run (America/New_York)", () => {
    // From 2025-10-06T13:30:00Z is 09:30 in New York (EDT) on the same day
    // Cron at 10:00 local time should resolve to 14:00Z
    const next = computeNextRun({
      cron: "0 10 * * *",
      timezone: "America/New_York",
      from,
    });
    expect(next?.toISOString()).toBe("2025-10-06T14:00:00.000Z");
  });

  it("returns null for invalid cron expression", () => {
    const next = computeNextRun({
      cron: "invalid cron",
      timezone: "UTC",
      from,
    });
    expect(next).toBeNull();
  });
});
