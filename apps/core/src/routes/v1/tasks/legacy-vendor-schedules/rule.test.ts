import { TaskScheduleEndsMode } from "@sokosumi/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_AUTH,
  seedTaskSchedule,
  userAuth,
} from "@/test-fixtures/task-schedule";

import { migratedTaskScheduleId, shimCreateOperationId } from "./ids";
import { legacyRuleMatches, mapLegacyRuleToUpdate } from "./rule";
import { legacySeriesView } from "./series";
import { legacyScheduleVendor } from "./vendor";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const RECURRING = {
  mode: "recurring" as const,
  expr: "0 9 * * 1",
  timezone: "UTC",
  endsMode: "after" as const,
};

describe("legacy schedule rule", () => {
  it("counts occurrences from the Runs already released", () => {
    const current = seedTaskSchedule({
      endsMode: TaskScheduleEndsMode.AFTER,
      targetRunCount: 5,
      releasedCount: 3,
    });

    expect(
      JSON.parse(legacySeriesView(current, current.id).metadata ?? "{}"),
    ).toMatchObject({ occurrences: 2 });
    expect(legacyRuleMatches(current, { ...RECURRING, occurrences: 2 })).toBe(
      true,
    );
    expect(legacyRuleMatches(current, { ...RECURRING, occurrences: 5 })).toBe(
      false,
    );
    expect(
      mapLegacyRuleToUpdate({ ...RECURRING, occurrences: 4 }, current),
    ).toMatchObject({
      expectedRevision: current.revision,
      rule: { targetRunCount: 7 },
    });
  });

  it("matches a re-sent rule, but not a changed timezone", () => {
    const current = seedTaskSchedule();
    const weekly = { ...RECURRING, endsMode: "never" as const };

    expect(legacyRuleMatches(current, weekly)).toBe(true);
    expect(
      legacyRuleMatches(current, { ...weekly, timezone: "Europe/Berlin" }),
    ).toBe(false);
  });

  it("derives distinct RFC 9562 UUID v8 ids per kind", () => {
    const uuidV8 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const taskId = "01960001-0001-7001-8001-0000000000f1";

    expect(migratedTaskScheduleId(taskId)).toMatch(uuidV8);
    expect(shimCreateOperationId(taskId)).toMatch(uuidV8);
    expect(migratedTaskScheduleId(taskId)).not.toBe(
      shimCreateOperationId(taskId),
    );
  });
});

describe("legacy schedule vendor gate", () => {
  afterEach(() => {
    delete process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS;
    vi.useRealTimers();
  });

  it("admits only Coworkers of listed vendors, until the sunset", () => {
    expect(legacyScheduleVendor(COWORKER_AUTH)).toBeNull();

    process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS = ` other, ${
      COWORKER_AUTH.actor === "coworker" ? COWORKER_AUTH.vendorId : ""
    } `;
    expect(legacyScheduleVendor(COWORKER_AUTH)).toBe(COWORKER_AUTH);
    expect(legacyScheduleVendor(userAuth())).toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T22:00:00.000Z"));
    expect(legacyScheduleVendor(COWORKER_AUTH)).toBeNull();
  });
});
