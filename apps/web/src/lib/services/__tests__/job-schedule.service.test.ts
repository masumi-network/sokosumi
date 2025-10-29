// No-op server-only in Jest
jest.mock("server-only", () => ({}));

jest.mock("p-limit", () => ({
  __esModule: true,
  default: () => () => Promise.resolve(),
}));
jest.mock("@/lib/db/repositories/job-schedule.repository", () => ({
  __esModule: true,
  jobScheduleRepository: {
    findDue: async () => [],
    getById: async () => ({ pauseReason: null }),
  },
}));
jest.mock("@sentry/nextjs", () => ({
  __esModule: true,
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock("@/config/env.secrets", () => ({
  __esModule: true,
  getEnvSecrets: () => ({ INSTANCE_ID: "test-instance" }),
}));
// Avoid importing heavy/ESM-only dependencies from job.service and Ably publish
jest.mock("@/lib/services/job.service", () => ({
  __esModule: true,
  jobService: { startJob: jest.fn().mockResolvedValue({}) },
}));
jest.mock("@/lib/ably/publish", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));
// No additional mocks needed when importing the pure cron module

import { computeNextRun } from "@/lib/utils/cron";
import { jobScheduleService } from "@/lib/services/job-schedule.service";

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

  it("handles DST spring-forward gap (Europe/London)", () => {
    // UK DST starts last Sunday in March; 2025-03-30 jumps 01:00 -> 02:00
    const gapFrom = new Date("2025-03-30T00:30:00.000Z");
    const next = computeNextRun({
      cron: "0 1 * * *", // 01:00 local time (non-existent on DST start)
      timezone: "Europe/London",
      from: gapFrom,
    });
    // Expect next run to be 02:00 local (01:00 skipped), which is 01:00Z
    // 2025-03-30 Europe/London 02:00 == 01:00Z
    expect(next?.toISOString()).toBe("2025-03-30T01:00:00.000Z");
  });

  it("returns null for invalid timezone", () => {
    const next = computeNextRun({
      cron: "0 10 * * *",
      timezone: "Invalid/Timezone",
      from,
    });
    expect(next).toBeNull();
  });
});

// Basic smoke test for executeDueSchedules return shape
describe("jobScheduleService.executeDueSchedules", () => {
  it("returns metrics object", async () => {
    const result = await jobScheduleService.executeDueSchedules();
    expect(result).toHaveProperty("dueFound");
    expect(result).toHaveProperty("processed");
    expect(result).toHaveProperty("paused");
    expect(result).toHaveProperty("durationMs");
  });
});
