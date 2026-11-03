import { describe, expect, it } from "vitest";

import {
  compareWarmupRecipients,
  utcDay,
  type WarmupRecipient,
  warmupDailyCap,
  warmupDay,
  warmupPauseReason,
  warmupRates,
} from "./sending-domain-warmup";

describe("sending domain warmup", () => {
  it("starts each UTC day at midnight without changing the input", () => {
    const date = new Date("2026-10-28T23:30:00-07:00");

    expect(utcDay(date)).toEqual(new Date("2026-10-29T00:00:00Z"));
    expect(date.toISOString()).toBe("2026-10-29T06:30:00.000Z");
  });

  it("counts UTC calendar days instead of elapsed 24-hour periods", () => {
    const start = new Date("2026-10-29T23:59:59Z");

    expect(warmupDay(start, new Date("2026-10-29T23:59:59Z"))).toBe(0);
    expect(warmupDay(start, new Date("2026-10-30T00:00:00Z"))).toBe(1);
    expect(warmupDay(start, new Date("2026-11-01T00:00:00Z"))).toBe(3);
    expect(warmupDay(start, new Date("2026-10-28T00:00:00Z"))).toBe(0);
  });

  it("counts UTC days across leap days and daylight saving time changes", () => {
    expect(
      warmupDay(
        new Date("2024-02-28T23:00:00Z"),
        new Date("2024-03-01T01:00:00Z"),
      ),
    ).toBe(2);
    expect(
      warmupDay(
        new Date("2026-10-31T23:00:00-07:00"),
        new Date("2026-11-01T23:00:00-08:00"),
      ),
    ).toBe(1);
  });

  it.each([
    [0, 50],
    [2, 50],
    [3, 100],
    [6, 100],
    [7, 250],
    [13, 250],
    [14, 500],
    [20, 500],
    [21, 1_000],
    [27, 1_000],
    [28, null],
    [365, null],
  ])("caps day %s at %s sends", (day, cap) => {
    expect(warmupDailyCap(day)).toBe(cap);
  });

  it("ranks recent engagement before signup recency, then uses the id", () => {
    const older = new Date("2026-10-01T00:00:00Z");
    const newer = new Date("2026-10-20T00:00:00Z");
    const recipients: WarmupRecipient[] = [
      {
        id: "z",
        lastEngagedAt: null,
        confirmedAt: newer,
        consentAt: null,
      },
      {
        id: "c",
        lastEngagedAt: older,
        confirmedAt: newer,
        consentAt: null,
      },
      {
        id: "b",
        lastEngagedAt: newer,
        confirmedAt: null,
        consentAt: older,
      },
      {
        id: "a",
        lastEngagedAt: newer,
        confirmedAt: older,
        consentAt: newer,
      },
      {
        id: "d",
        lastEngagedAt: newer,
        confirmedAt: null,
        consentAt: newer,
      },
    ];

    expect(
      recipients.sort(compareWarmupRecipients).map(({ id }) => id),
    ).toEqual(["d", "a", "b", "c", "z"]);
  });

  it("places recipients without signup or engagement dates last", () => {
    const undated: WarmupRecipient = {
      id: "a",
      lastEngagedAt: null,
      confirmedAt: null,
      consentAt: null,
    };
    const dated: WarmupRecipient = {
      ...undated,
      id: "b",
      consentAt: new Date("2026-10-01T00:00:00Z"),
    };

    expect([undated, dated].sort(compareWarmupRecipients)).toEqual([
      dated,
      undated,
    ]);
    expect(compareWarmupRecipients(undated, undated)).toBe(0);
  });

  it("calculates rates against attempted sends and handles an empty sample", () => {
    expect(
      warmupRates({ attempted: 100, hardBounced: 5, complained: 1 }),
    ).toEqual({ bounceRate: 0.05, complaintRate: 0.01, sampleSize: 100 });
    expect(
      warmupRates({ attempted: 0, hardBounced: 0, complained: 0 }),
    ).toEqual({ bounceRate: 0, complaintRate: 0, sampleSize: 0 });
  });

  it("requires 50 attempts before pausing even if all attempts failed", () => {
    expect(
      warmupPauseReason(
        warmupRates({ attempted: 49, hardBounced: 49, complained: 49 }),
      ),
    ).toBeNull();
    expect(
      warmupPauseReason(
        warmupRates({ attempted: 50, hardBounced: 3, complained: 0 }),
      ),
    ).toBe("BOUNCE_RATE");
  });

  it("pauses only above the bounce and complaint thresholds", () => {
    expect(
      warmupPauseReason(
        warmupRates({ attempted: 1_000, hardBounced: 40, complained: 1 }),
      ),
    ).toBeNull();
    expect(
      warmupPauseReason(
        warmupRates({ attempted: 1_000, hardBounced: 41, complained: 1 }),
      ),
    ).toBe("BOUNCE_RATE");
    expect(
      warmupPauseReason(
        warmupRates({ attempted: 1_000, hardBounced: 40, complained: 2 }),
      ),
    ).toBe("COMPLAINT_RATE");
  });

  it("prioritizes the complaint notice when both thresholds are exceeded", () => {
    expect(
      warmupPauseReason(
        warmupRates({ attempted: 50, hardBounced: 3, complained: 1 }),
      ),
    ).toBe("COMPLAINT_RATE");
  });
});
