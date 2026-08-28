import { describe, expect, it } from "vitest";

import {
  hasActiveTaskSchedule,
  parseTaskScheduleMetadata,
} from "./task-schedule.js";

const onceMetadata = JSON.stringify({
  version: 1,
  mode: "once",
  scheduledAt: "2026-08-01T10:00:00.000Z",
  runAt: "2026-08-01T10:00:00.000Z",
});

const recurringMetadata = JSON.stringify({
  version: 1,
  mode: "recurring",
  scheduledAt: "2026-08-01T10:00:00.000Z",
  expr: "0 9 * * *",
  timezone: "UTC",
  endsMode: "never",
});

const onceMetadataV2 = JSON.stringify({
  version: 2,
  epochId: "123e4567-e89b-42d3-a456-426614174000",
  mode: "once",
  createdAt: "2026-08-01T08:00:00.000Z",
  ruleEffectiveFrom: "2026-08-01T08:00:00.000Z",
  timezone: "UTC",
  sourceRunAt: "2026-08-01T10:00:00.000Z",
  effectiveRunAt: "2026-08-01T10:00:00.000Z",
});

const recurringMetadataV2 = JSON.stringify({
  version: 2,
  epochId: "123e4567-e89b-42d3-a456-426614174001",
  mode: "recurring",
  createdAt: "2026-08-01T08:00:00.000Z",
  ruleEffectiveFrom: "2026-08-01T08:00:00.000Z",
  timezone: "Europe/Berlin",
  expr: "0 9 * * *",
  endsMode: "after",
  targetReleaseCount: 5,
  epochReleaseCount: 0,
  anchorAt: "2026-08-01T07:00:00.000Z",
});

describe("parseTaskScheduleMetadata", () => {
  it("parses valid version 1 and version 2 schedule metadata", () => {
    expect(parseTaskScheduleMetadata(onceMetadata)).toMatchObject({
      version: 1,
      mode: "once",
      runAt: "2026-08-01T10:00:00.000Z",
    });
    expect(parseTaskScheduleMetadata(recurringMetadata)).toMatchObject({
      version: 1,
      mode: "recurring",
      expr: "0 9 * * *",
    });
    expect(parseTaskScheduleMetadata(onceMetadataV2)).toMatchObject({
      version: 2,
      mode: "once",
      sourceRunAt: "2026-08-01T10:00:00.000Z",
    });
    expect(parseTaskScheduleMetadata(recurringMetadataV2)).toMatchObject({
      version: 2,
      mode: "recurring",
      targetReleaseCount: 5,
      epochReleaseCount: 0,
    });
  });

  it("rejects incomplete or contradictory version 2 metadata", () => {
    expect(
      parseTaskScheduleMetadata(
        JSON.stringify({
          version: 2,
          epochId: "not-a-uuid",
          mode: "once",
          createdAt: "2026-08-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-08-01T08:00:00.000Z",
          timezone: "UTC",
          sourceRunAt: "2026-08-01T10:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(
      parseTaskScheduleMetadata(
        JSON.stringify({
          ...JSON.parse(recurringMetadataV2),
          endsMode: "on",
          endsOn: undefined,
        }),
      ),
    ).toBeNull();
    expect(
      parseTaskScheduleMetadata(
        JSON.stringify({
          ...JSON.parse(recurringMetadataV2),
          endsMode: "never",
          endsOn: "2026-09-01T00:00:00.000Z",
          targetReleaseCount: undefined,
        }),
      ),
    ).toBeNull();
    expect(
      parseTaskScheduleMetadata(
        JSON.stringify({
          ...JSON.parse(recurringMetadataV2),
          endsMode: "after",
          endsOn: "2026-09-01T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
  });

  it("rejects invalid JSON and unknown metadata versions", () => {
    expect(parseTaskScheduleMetadata("{not-json")).toBeNull();
    expect(
      parseTaskScheduleMetadata(JSON.stringify({ version: 3, mode: "once" })),
    ).toBeNull();
  });
});

describe("hasActiveTaskSchedule", () => {
  it("returns true for valid once metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule(onceMetadata, null)).toBe(true);
  });

  it("returns true for valid recurring metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule(recurringMetadata, null)).toBe(true);
  });

  it("returns true when only nextRunAt is set (Date)", () => {
    expect(
      hasActiveTaskSchedule(null, new Date("2026-08-01T10:00:00.000Z")),
    ).toBe(true);
  });

  it("returns true when only nextRunAt is set (ISO string)", () => {
    expect(hasActiveTaskSchedule(null, "2026-08-01T10:00:00.000Z")).toBe(true);
  });

  it("returns false when both are empty", () => {
    expect(hasActiveTaskSchedule(null, null)).toBe(false);
    expect(hasActiveTaskSchedule(undefined, undefined)).toBe(false);
    expect(hasActiveTaskSchedule("", null)).toBe(false);
  });

  it("returns false for invalid JSON metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule("{not-json", null)).toBe(false);
  });

  it("recognizes version 2 metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule(onceMetadataV2, null)).toBe(true);
    expect(hasActiveTaskSchedule(recurringMetadataV2, null)).toBe(true);
  });

  it("conservatively recognizes known metadata shapes without nextRunAt", () => {
    expect(
      hasActiveTaskSchedule(JSON.stringify({ version: 2, mode: "once" }), null),
    ).toBe(true);
  });

  it("returns false for unsupported version or mode without nextRunAt", () => {
    expect(
      hasActiveTaskSchedule(
        JSON.stringify({ version: 1, mode: "other" }),
        null,
      ),
    ).toBe(false);
    expect(
      hasActiveTaskSchedule(JSON.stringify({ version: 3, mode: "once" }), null),
    ).toBe(false);
  });

  it("returns true when nextRunAt is present even if metadata is invalid", () => {
    expect(
      hasActiveTaskSchedule("{not-json", new Date("2026-08-01T10:00:00.000Z")),
    ).toBe(true);
  });
});
