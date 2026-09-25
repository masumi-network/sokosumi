import { TaskScheduleEndsMode } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  migratedTaskScheduleId,
  shimCreatedTaskScheduleId,
} from "@/helpers/legacy-task-schedule-id";
import {
  mapLegacyCreateToTaskSchedule,
  mapLegacyPutScheduleToUpdate,
} from "@/helpers/legacy-task-schedule-shim";

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

  it("maps a PUT body onto expectedRevision plus a typed rule", () => {
    expect(
      mapLegacyPutScheduleToUpdate(
        {
          mode: "recurring",
          expr: "0 10 * * 1",
          timezone: "UTC",
          endsMode: "never",
        },
        3,
      ),
    ).toMatchObject({
      expectedRevision: 3,
      rule: { expr: "0 10 * * 1", endsMode: TaskScheduleEndsMode.NEVER },
    });
  });
});

describe("legacy task schedule ids", () => {
  it("mints RFC 9562 UUID v8 ids, distinct per kind", () => {
    const migrated = migratedTaskScheduleId(TEMPLATE_ID);
    const shimmed = shimCreatedTaskScheduleId(TEMPLATE_ID);
    const uuidV8 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(migrated).toMatch(uuidV8);
    expect(shimmed).toMatch(uuidV8);
    expect(migrated).not.toBe(shimmed);
    expect(migratedTaskScheduleId(TEMPLATE_ID)).toBe(migrated);
  });
});
