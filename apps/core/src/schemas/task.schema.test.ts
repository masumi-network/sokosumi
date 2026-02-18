import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { coworkerSchema, taskEventSchema } from "./task.schema";

describe("taskEventWithTaskIdSchema", () => {
  it("parses a valid event with taskId and Date fields", () => {
    const result = taskEventSchema.parse({
      id: "evt_123",
      taskId: "tsk_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      comment: "Looks good.",
      authenticationUrl: null,
      origin: TaskEventOrigin.SOKOSUMI,
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
        origin: TaskEventOrigin.SOKOSUMI,
        status: TaskStatus.RUNNING,
        userId: "user_123",
        coworkerId: "cow_123",
      });
    }).toThrow();
  });
});

describe("coworkerSchema", () => {
  it("parses coworker profile metadata fields", () => {
    const result = coworkerSchema.parse({
      id: "cow_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      slug: "ops-agent",
      name: "Ops Agent",
      url: "https://example.com",
      email: "ops@example.com",
      description: "Ops helper",
      image: "https://example.com/image.png",
      caption: "Senior Campaign Partner",
      company: "Serviceplan",
      companyLogo: "https://example.com/company-logo.png",
    });

    expect(result.caption).toBe("Senior Campaign Partner");
    expect(result.company).toBe("Serviceplan");
    expect(result.companyLogo).toBe("https://example.com/company-logo.png");
    expect(typeof result.createdAt).toBe("string");
    expect(typeof result.updatedAt).toBe("string");
  });
});
