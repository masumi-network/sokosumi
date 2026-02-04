import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { createTaskRequestSchema } from "./post";

describe("createTaskRequestSchema", () => {
  it("defaults status to DRAFT when omitted", () => {
    const result = createTaskRequestSchema.parse({
      name: "New Task",
      description: "Task description",
      orchestratorId: null,
    });

    expect(result.status).toBe(TaskStatus.DRAFT);
  });

  it("accepts READY status", () => {
    const result = createTaskRequestSchema.parse({
      name: "Ready task",
      description: null,
      orchestratorId: "orc_123",
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
            orchestratorId: null,
            status,
          });
        }).toThrow();
      }
    });
  });
});
