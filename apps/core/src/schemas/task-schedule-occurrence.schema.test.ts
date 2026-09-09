import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  taskScheduleOccurrencePageSchema,
  taskScheduleOccurrenceQuerySchema,
  taskScheduleOccurrenceSchema,
} from "./task-schedule-occurrence.schema";

function createOccurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-7333-8333-333333333333",
    state: TaskScheduleOccurrenceState.RELEASED,
    scheduleVersion: 2,
    epochId: "44444444-4444-7444-8444-444444444444",
    originalScheduledAt: new Date("2026-06-01T09:00:00.000Z"),
    effectiveScheduledAt: new Date("2026-06-01T09:00:00.000Z"),
    timezone: "Europe/Berlin",
    isMissed: false,
    sourceId: "workspace:11111111-1111-7111-8111-111111111111",
    sourceWorkspaceId: "11111111-1111-7111-8111-111111111111",
    sourceType: CalendarSourceType.WORKSPACE,
    sourceProjectId: null,
    sourceAccuracy: CalendarSourceAccuracy.EXACT,
    timeAccuracy: CalendarTimeAccuracy.EXACT,
    releasedTask: {
      id: "tsk_released",
      name: "Prepare release notes",
      status: TaskStatus.COMPLETED,
      archivedAt: null,
    },
    ...overrides,
  };
}

describe("taskScheduleOccurrenceQuerySchema", () => {
  it("defaults to the upcoming view and the shared pagination limit", () => {
    const parsed = taskScheduleOccurrenceQuerySchema.parse({});

    expect(parsed).toEqual({ view: "upcoming", limit: 20 });
  });

  it("accepts the history view and coerces a numeric limit", () => {
    const parsed = taskScheduleOccurrenceQuerySchema.parse({
      view: "history",
      limit: "50",
      cursor: "opaque-cursor",
    });

    expect(parsed).toEqual({
      view: "history",
      limit: 50,
      cursor: "opaque-cursor",
    });
  });

  it("rejects an unknown view and a limit above the shared maximum", () => {
    expect(
      taskScheduleOccurrenceQuerySchema.safeParse({ view: "all" }).success,
    ).toBe(false);
    expect(
      taskScheduleOccurrenceQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      taskScheduleOccurrenceQuerySchema.safeParse({ limit: 0 }).success,
    ).toBe(false);
  });
});

describe("taskScheduleOccurrenceSchema", () => {
  it("serializes ledger identity, timing, source snapshot, and released task", () => {
    const parsed = taskScheduleOccurrenceSchema.parse(createOccurrence());

    expect(parsed).toMatchObject({
      state: "RELEASED",
      scheduleVersion: 2,
      epochId: "44444444-4444-7444-8444-444444444444",
      originalScheduledAt: "2026-06-01T09:00:00.000Z",
      effectiveScheduledAt: "2026-06-01T09:00:00.000Z",
      timezone: "Europe/Berlin",
      isMissed: false,
      sourceType: "WORKSPACE",
      sourceProjectId: null,
      releasedTask: {
        id: "tsk_released",
        status: "COMPLETED",
        archivedAt: null,
      },
    });
  });

  it("keeps legacy epoch, original time, timezone, and released task nullable", () => {
    const parsed = taskScheduleOccurrenceSchema.parse(
      createOccurrence({
        state: TaskScheduleOccurrenceState.PLANNED,
        scheduleVersion: 1,
        epochId: null,
        originalScheduledAt: null,
        timezone: null,
        isMissed: true,
        releasedTask: null,
      }),
    );

    expect(parsed).toMatchObject({
      epochId: null,
      originalScheduledAt: null,
      timezone: null,
      isMissed: true,
      releasedTask: null,
    });
  });

  it("keeps an archived released task summary and serializes its archive time", () => {
    const parsed = taskScheduleOccurrenceSchema.parse(
      createOccurrence({
        releasedTask: {
          id: "tsk_released",
          name: "Prepare release notes",
          status: TaskStatus.COMPLETED,
          archivedAt: new Date("2026-06-02T09:00:00.000Z"),
        },
      }),
    );

    expect(parsed.releasedTask).toEqual({
      id: "tsk_released",
      name: "Prepare release notes",
      status: "COMPLETED",
      archivedAt: "2026-06-02T09:00:00.000Z",
    });
  });

  it("requires the released task archive field to be present", () => {
    expect(
      taskScheduleOccurrenceSchema.safeParse(
        createOccurrence({
          releasedTask: {
            id: "tsk_released",
            name: "Prepare release notes",
            status: TaskStatus.COMPLETED,
          },
        }),
      ).success,
    ).toBe(false);
  });
});

describe("taskScheduleOccurrencePageSchema", () => {
  it("carries the observed schedule revision alongside an empty page", () => {
    const parsed = taskScheduleOccurrencePageSchema.parse({
      scheduleRevision: 4,
      occurrences: [],
    });

    expect(parsed).toEqual({ scheduleRevision: 4, occurrences: [] });
  });

  it("requires the schedule revision", () => {
    expect(
      taskScheduleOccurrencePageSchema.safeParse({ occurrences: [] }).success,
    ).toBe(false);
  });
});
