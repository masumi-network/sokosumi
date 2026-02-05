import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { createTaskEventRequestSchema } from "./schema";

describe("createTaskEventRequestSchema", () => {
  it("accepts a valid origin", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      origin: TaskEventOrigin.SLACK,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.origin).toBe(TaskEventOrigin.SLACK);
    }
  });

  it("throws an error for unsupported origins", () => {
    expect(() => {
      createTaskEventRequestSchema.parse({
        status: TaskStatus.RUNNING,
        origin: "Discord",
      });
    }).toThrow();
  });

  it("throws an error for null origin", () => {
    expect(() => {
      createTaskEventRequestSchema.parse({
        status: TaskStatus.RUNNING,
        origin: null,
      });
    }).toThrow();
  });

  it("defaults missing origin to SOKOSUMI", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.origin).toBe(TaskEventOrigin.SOKOSUMI);
    }
  });

  it("accepts authentication required with https url", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
      authenticationUrl: "https://example.com/oauth/authorize",
    });

    expect(result.success).toBe(true);
  });

  it("rejects authentication required without auth url", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-https auth url", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
      authenticationUrl: "http://example.com/oauth/authorize",
    });

    expect(result.success).toBe(false);
  });

  it("rejects auth url for non-auth status", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      authenticationUrl: "https://example.com/oauth/authorize",
    });

    expect(result.success).toBe(false);
  });

  it("rejects auth url for comment-only events", () => {
    const result = createTaskEventRequestSchema.safeParse({
      comment: "Needs attention",
      authenticationUrl: "https://example.com/oauth/authorize",
    });

    expect(result.success).toBe(false);
  });
});
