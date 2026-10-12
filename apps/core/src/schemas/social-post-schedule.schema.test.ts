import { describe, expect, it } from "vitest";

import { scheduleSocialPostRequestSchema } from "./social-post.schema";

const scheduledAt = "2026-09-23T10:00:00.000Z";

describe("scheduleSocialPostRequestSchema", () => {
  it("requires scheduledAt and a non-negative revision", () => {
    expect(
      scheduleSocialPostRequestSchema.safeParse({ revision: 0 }).success,
    ).toBe(false);
    expect(
      scheduleSocialPostRequestSchema.safeParse({ scheduledAt }).success,
    ).toBe(false);
    expect(
      scheduleSocialPostRequestSchema.safeParse({
        scheduledAt,
        revision: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO scheduledAt", () => {
    expect(
      scheduleSocialPostRequestSchema.safeParse({
        scheduledAt: "2026-09-23 10:00",
        revision: 0,
      }).success,
    ).toBe(false);
  });

  it("accepts an ISO time without a timezone", () => {
    const result = scheduleSocialPostRequestSchema.safeParse({
      scheduledAt,
      revision: 0,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.scheduledAt).toBe(scheduledAt);
    expect(result.data.timezone).toBeUndefined();
  });

  it("accepts a Date by converting it to ISO", () => {
    const result = scheduleSocialPostRequestSchema.safeParse({
      scheduledAt: new Date(scheduledAt),
      revision: 1,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.scheduledAt).toBe(scheduledAt);
  });
});
