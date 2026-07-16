import { Channel, TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { taskEventSchema } from "./task.schema";

describe("taskEventWithTaskIdSchema", () => {
  it("parses a valid event with taskId and Date fields", () => {
    const result = taskEventSchema.parse({
      id: "evt_123",
      taskId: "tsk_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      comment: "Looks good.",
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      status: TaskStatus.RUNNING,
      userId: "user_123",
      coworkerId: "cow_123",
      transactionId: "txn_123",
      credits: 2.5,
    });

    expect(result.taskId).toBe("tsk_123");
    expect(typeof result.createdAt).toBe("string");
    expect(typeof result.updatedAt).toBe("string");
    expect(result.transactionId).toBe("txn_123");
    expect(result.credits).toBe(2.5);
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
