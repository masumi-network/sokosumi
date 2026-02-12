import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { createTaskRequestSchema } from "./post";

describe("createTaskRequestSchema", () => {
  it("defaults status to DRAFT when omitted", () => {
    const result = createTaskRequestSchema.parse({
      name: "New Task",
      description: "Task description",
      coworkerId: null,
    });

    expect(result.status).toBe(TaskStatus.DRAFT);
  });

  it("accepts READY status", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      coworkerId: "cow_123",
      status: TaskStatus.READY,
    });

    expect(result.status).toBe(TaskStatus.READY);
  });

  it("rejects READY status without coworkerId", () => {
    expect(() => {
      createTaskRequestSchema.parse({
        name: "Ready task",
        description: null,
        coworkerId: null,
        status: TaskStatus.READY,
      });
    }).toThrow();
  });

  it("accepts READY status with whitespace coworkerId at schema layer", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      coworkerId: "  ",
      status: TaskStatus.READY,
    });

    expect(result.status).toBe(TaskStatus.READY);
  });

  it("rejects unsupported status values", () => {
    Object.values(TaskStatus).forEach((status) => {
      if (status !== TaskStatus.DRAFT && status !== TaskStatus.READY) {
        expect(() => {
          createTaskRequestSchema.parse({
            name: "Invalid task",
            description: null,
            coworkerId: null,
            status,
          });
        }).toThrow();
      }
    });
  });
});
