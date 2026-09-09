import { describe, expect, it } from "vitest";

import {
  getTaskScheduleInput,
  putCalendarTaskScheduleRequestSchema,
  putTaskScheduleRequestSchema,
} from "@/schemas/task-schedule.schema";

const onceSchedule = {
  mode: "once" as const,
  runAt: "2026-09-24T09:00:00.000Z",
};

describe("putCalendarTaskScheduleRequestSchema", () => {
  it("accepts the operation-aware Calendar envelope", () => {
    const request = putCalendarTaskScheduleRequestSchema.parse({
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      expectedScheduleRevision: 3,
      discardFutureExceptions: true,
      schedule: onceSchedule,
    });

    expect(request.operationId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(request.expectedScheduleRevision).toBe(3);
    expect(request.schedule).toEqual(onceSchedule);
  });

  it("rejects the legacy bare schedule body", () => {
    expect(
      putCalendarTaskScheduleRequestSchema.safeParse(onceSchedule).success,
    ).toBe(false);
  });

  it("rejects an operation identity that is not a UUID", () => {
    expect(
      putCalendarTaskScheduleRequestSchema.safeParse({
        operationId: "operation-1",
        expectedScheduleRevision: 0,
        discardFutureExceptions: true,
        schedule: onceSchedule,
      }).success,
    ).toBe(false);
  });

  it("requires explicit exception discard confirmation", () => {
    expect(
      putCalendarTaskScheduleRequestSchema.safeParse({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        expectedScheduleRevision: 3,
        discardFutureExceptions: false,
        schedule: onceSchedule,
      }).success,
    ).toBe(false);
  });

  it("requires the observed schedule revision", () => {
    expect(
      putCalendarTaskScheduleRequestSchema.safeParse({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        discardFutureExceptions: true,
        schedule: onceSchedule,
      }).success,
    ).toBe(false);
  });
});

describe("putTaskScheduleRequestSchema", () => {
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
