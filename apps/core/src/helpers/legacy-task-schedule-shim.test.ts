import { TaskScheduleEndsMode } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import { isLegacyTaskScheduleShimEnabled } from "@/config/env";

import {
  migratedTaskScheduleId,
  shimCreateOperationId,
} from "@/helpers/legacy-task-schedule-id";
import {
  legacyRuleMatches,
  mapLegacyCreateToTaskSchedule,
  mapLegacyRuleToUpdate,
  mapTaskScheduleToLegacyProjection,
} from "@/helpers/legacy-task-schedule-shim";
import { seedTaskSchedule } from "@/test-fixtures/task-schedule";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const TEMPLATE_ID = "01960001-0001-7001-8001-0000000000f1";

function cause(error: unknown) {
  return (error as HTTPException).cause as {
    extensions?: { replacement?: string };
  };
}

describe("legacy task schedule mapping", () => {
  it("maps a recurring create onto the typed Task Schedule rule", () => {
    const mapped = mapLegacyCreateToTaskSchedule({
      source: { type: "workspace" },
      name: "Weekly report",
      schedule: {
        mode: "recurring",
        expr: "0 9 * * 1",
        timezone: "Europe/Berlin",
        endsMode: "after",
        occurrences: 5,
      },
    });

    expect(mapped).toMatchObject({
      name: "Weekly report",
      rule: {
        expr: "0 9 * * 1",
        timezone: "Europe/Berlin",
        endsMode: TaskScheduleEndsMode.AFTER,
        targetRunCount: 5,
      },
    });
  });

  it("rejects once-mode instead of creating a Task", () => {
    try {
      mapLegacyCreateToTaskSchedule({
        source: { type: "workspace" },
        name: "One shot",
        schedule: { mode: "once", runAt: "2030-01-01T09:00:00.000Z" },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(422);
      expect(cause(error).extensions?.replacement).toBe("POST /v1/tasks");
    }
  });

  it("rejects a person assignee", () => {
    try {
      mapLegacyCreateToTaskSchedule({
        source: { type: "workspace" },
        name: "Weekly report",
        assigneeUserId: "user_member",
        schedule: {
          mode: "recurring",
          expr: "0 9 * * 1",
          timezone: "UTC",
          endsMode: "never",
        },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as HTTPException).status).toBe(422);
      expect(cause(error).extensions?.replacement).toBe(
        "POST /v1/tasks/schedules",
      );
    }
  });

  it("maps a PUT body onto the current revision plus a typed rule", () => {
    const current = seedTaskSchedule({ revision: 3 });

    expect(
      mapLegacyRuleToUpdate(
        {
          mode: "recurring",
          expr: "0 10 * * 1",
          timezone: "UTC",
          endsMode: "never",
        },
        current,
      ),
    ).toMatchObject({
      expectedRevision: 3,
      rule: { expr: "0 10 * * 1", endsMode: TaskScheduleEndsMode.NEVER },
    });
  });

  it("counts occurrences from the Runs already released", () => {
    const current = seedTaskSchedule({
      endsMode: TaskScheduleEndsMode.AFTER,
      targetRunCount: 5,
      releasedCount: 3,
    });
    const rule = {
      mode: "recurring" as const,
      expr: "0 9 * * 1",
      timezone: "UTC",
      endsMode: "after" as const,
    };

    expect(
      mapTaskScheduleToLegacyProjection(current).schedule.occurrences,
    ).toBe(2);
    expect(legacyRuleMatches(current, { ...rule, occurrences: 2 })).toBe(true);
    expect(legacyRuleMatches(current, { ...rule, occurrences: 5 })).toBe(false);
    expect(
      mapLegacyRuleToUpdate({ ...rule, occurrences: 4 }, current).rule,
    ).toMatchObject({ targetRunCount: 7 });
  });

  it("matches a re-sent rule regardless of the anchor of a daily rule", () => {
    const current = seedTaskSchedule();

    expect(
      legacyRuleMatches(current, {
        mode: "recurring",
        expr: "0 9 * * 1",
        timezone: "UTC",
        endsMode: "never",
      }),
    ).toBe(true);
    expect(
      legacyRuleMatches(current, {
        mode: "recurring",
        expr: "0 9 * * 1",
        timezone: "Europe/Berlin",
        endsMode: "never",
      }),
    ).toBe(false);
  });
});

describe("legacy task schedule ids", () => {
  it("mints RFC 9562 UUID v8 ids, distinct per kind", () => {
    const migrated = migratedTaskScheduleId(TEMPLATE_ID);
    const shimmed = shimCreateOperationId(TEMPLATE_ID);
    const uuidV8 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(migrated).toMatch(uuidV8);
    expect(shimmed).toMatch(uuidV8);
    expect(migrated).not.toBe(shimmed);
    expect(migratedTaskScheduleId(TEMPLATE_ID)).toBe(migrated);
  });
});

describe("legacy task schedule shim sunset", () => {
  it("is off at EOD 2026-09-29 CEST even when the flag is on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T22:00:00.000Z"));
    process.env.LEGACY_TASK_SCHEDULE_SHIM = "1";
    expect(isLegacyTaskScheduleShimEnabled()).toBe(false);
    vi.useRealTimers();
  });
});
