<<<<<<< Updated upstream
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
=======
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TaskStatus } from "@sokosumi/database";
>>>>>>> Stashed changes

import { createTaskEventRequestSchema } from "./schema";

describe("createTaskEventRequestSchema", () => {
<<<<<<< Updated upstream
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
=======
  test("accepts authentication required with https url", () => {
>>>>>>> Stashed changes
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
      authenticationUrl: "https://example.com/oauth/authorize",
    });

<<<<<<< Updated upstream
    expect(result.success).toBe(true);
  });

  it("rejects authentication required without auth url", () => {
=======
    assert.equal(result.success, true);
  });

  test("rejects authentication required without auth url", () => {
>>>>>>> Stashed changes
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
    });

<<<<<<< Updated upstream
    expect(result.success).toBe(false);
  });

  it("rejects non-https auth url", () => {
=======
    assert.equal(result.success, false);
  });

  test("rejects non-https auth url", () => {
>>>>>>> Stashed changes
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.AUTHENTICATION_REQUIRED,
      authenticationUrl: "http://example.com/oauth/authorize",
    });

<<<<<<< Updated upstream
    expect(result.success).toBe(false);
  });

  it("rejects auth url for non-auth status", () => {
=======
    assert.equal(result.success, false);
  });

  test("rejects auth url for non-auth status", () => {
>>>>>>> Stashed changes
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      authenticationUrl: "https://example.com/oauth/authorize",
    });

<<<<<<< Updated upstream
    expect(result.success).toBe(false);
  });

  it("rejects auth url for comment-only events", () => {
=======
    assert.equal(result.success, false);
  });

  test("rejects auth url for comment-only events", () => {
>>>>>>> Stashed changes
    const result = createTaskEventRequestSchema.safeParse({
      comment: "Needs attention",
      authenticationUrl: "https://example.com/oauth/authorize",
    });

<<<<<<< Updated upstream
    expect(result.success).toBe(false);
  });

  it("accepts credits for canceled tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.CANCELED,
      credits: 3,
    });

    expect(result.success).toBe(true);
  });

  it("accepts completed tasks without credits", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
    });

    expect(result.success).toBe(true);
  });

  it("accepts zero credits for completed tasks", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.COMPLETED,
      credits: 0,
    });

    expect(result.success).toBe(true);
  });

  it("rejects credits for non-chargeable statuses", () => {
    const result = createTaskEventRequestSchema.safeParse({
      status: TaskStatus.RUNNING,
      credits: 2,
    });

    expect(result.success).toBe(false);
=======
    assert.equal(result.success, false);
>>>>>>> Stashed changes
  });
});
