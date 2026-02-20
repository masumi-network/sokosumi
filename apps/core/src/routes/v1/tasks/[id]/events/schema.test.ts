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

  it("accepts credits for canceled tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.CANCELED,
      credits: 3,
    });

    expect(result.success).toBe(true);
  });

  it("rejects out-of-credits tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.OUT_OF_CREDITS,
    });

    expect(result.success).toBe(false);
  });

  it("accepts completed tasks without credits", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
    });

    expect(result.success).toBe(true);
  });

  it.each([TaskStatus.COMPLETED, TaskStatus.CANCELED])(
    "accepts fractional credits for %s tasks",
    (status) => {
      const result = createTaskEventRequestSchema.safeParse({
        status,
        credits: 0.25,
      });

      expect(result.success).toBe(true);
    },
  );

  it("accepts null credits for completed tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects zero credits for completed tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: 0,
    });

    expect(result.success).toBe(false);
  });

  it("accepts null credits for non-chargeable statuses", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      credits: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects credits for non-chargeable statuses", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      credits: 2,
    });

    expect(result.success).toBe(false);
  });

  it("rejects credits for credits-topped-up tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.CREDITS_TOPPED_UP,
      credits: 2,
    });

    expect(result.success).toBe(false);
  });
});
