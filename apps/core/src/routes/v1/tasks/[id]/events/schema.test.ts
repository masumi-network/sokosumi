import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { createTaskEventRequestSchema } from "./schema";

describe("createTaskEventRequestSchema", () => {
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
