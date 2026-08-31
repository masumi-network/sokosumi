import { describe, expect, it } from "vitest";

import {
  getTaskScheduleInput,
  putTaskScheduleRequestSchema,
} from "@/schemas/task-schedule.schema";

describe("putTaskScheduleRequestSchema", () => {
  const onceSchedule = {
    mode: "once" as const,
    runAt: "2026-09-24T09:00:00.000Z",
  };

  it("keeps accepting the legacy direct schedule shape", () => {
    const request = putTaskScheduleRequestSchema.parse(onceSchedule);

    expect(getTaskScheduleInput(request)).toEqual(onceSchedule);
  });

  it("accepts an operation-aware envelope without changing its schedule", () => {
    const request = putTaskScheduleRequestSchema.parse({
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      expectedScheduleRevision: 3,
      discardFutureExceptions: true,
      schedule: onceSchedule,
    });

    expect(getTaskScheduleInput(request)).toEqual(onceSchedule);
  });

  it("requires explicit exception discard confirmation in the new envelope", () => {
    expect(
      putTaskScheduleRequestSchema.safeParse({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        expectedScheduleRevision: 3,
        discardFutureExceptions: false,
        schedule: onceSchedule,
      }).success,
    ).toBe(false);
  });
});
