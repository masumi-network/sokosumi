import { Channel, TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { taskEventSchema } from "./task.schema";

const defaultUser = {
  id: "user_123",
  name: "Test User",
  image: null,
};

const defaultCoworker = {
  id: "cow_123",
  name: "Test Coworker",
  image: null,
  slug: "test-coworker",
};

describe("taskEventWithTaskIdSchema", () => {
  it("parses a valid event with taskId and Date fields", () => {
    const result = taskEventSchema.parse({
      id: "evt_123",
      taskId: "tsk_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      actor: {
        type: "user",
        id: "user_123",
        user: defaultUser,
      },
      comment: "Looks good.",
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      status: TaskStatus.RUNNING,
      userId: "user_123",
      user: defaultUser,
      coworkerId: "cow_123",
      coworker: defaultCoworker,
      transactionId: "txn_123",
      credits: 2.5,
    });

    expect(result.taskId).toBe("tsk_123");
    expect(typeof result.createdAt).toBe("string");
    expect(typeof result.updatedAt).toBe("string");
    expect(result.transactionId).toBe("txn_123");
    expect(result.credits).toBe(2.5);
    expect(result.actor).toEqual({
      type: "user",
      id: "user_123",
      user: defaultUser,
    });
  });

  it("parses actor null when no actor FK is set", () => {
    const result = taskEventSchema.parse({
      id: "evt_123",
      taskId: "tsk_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      actor: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      status: TaskStatus.RUNNING,
    });

    expect(result.actor).toBeNull();
  });

  it("exposes optional schedule activity fields", () => {
    const result = taskEventSchema.parse({
      id: "evt_schedule",
      taskId: "tsk_123",
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
      updatedAt: new Date("2026-08-26T12:00:00.000Z"),
      actor: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      scheduleKind: TaskScheduleEventKind.OCCURRENCE_SKIPPED,
      schedulePayload: { occurrenceKey: "occurrence-key" },
      scheduleOperationId: "123e4567-e89b-42d3-a456-426614174000",
    });

    expect(result).toMatchObject({
      scheduleKind: TaskScheduleEventKind.OCCURRENCE_SKIPPED,
      schedulePayload: { occurrenceKey: "occurrence-key" },
      scheduleOperationId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("fails when taskId is missing", () => {
    expect(() => {
      taskEventSchema.parse({
        id: "evt_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        channel: Channel.SOKOSUMI,
        origin: Channel.SOKOSUMI,
        status: TaskStatus.RUNNING,
        userId: "user_123",
        coworkerId: "cow_123",
      });
    }).toThrow();
  });
});
