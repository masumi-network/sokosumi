import { describe, expect, it } from "vitest";

import {
  createSocialPostRequestSchema,
  scheduleSocialPostRequestSchema,
  socialPostLastAttemptSchema,
} from "./social-post.schema";

const FUTURE = "2026-11-01T12:00:00.000Z";

it("returns an attempt blocked by Project close through the public schema", () => {
  expect(
    socialPostLastAttemptSchema.parse({
      attempt: 1,
      trigger: "scheduler",
      outcome: "project_closed",
      errorKind: null,
      providerOutcome: null,
      finishedAt: FUTURE,
    }).outcome,
  ).toBe("project_closed");
});

describe("createSocialPostRequestSchema timezone", () => {
  it.each(["Europe/Zurich", "America/New_York", "UTC", "Etc/UTC"])(
    "accepts %s",
    (timezone) => {
      expect(
        createSocialPostRequestSchema.safeParse({
          text: "Hello",
          timezone,
        }).success,
      ).toBe(true);
    },
  );

  it.each(["Mars/Olympus", "America/New York", " Europe/Zurich"])(
    "rejects %s",
    (timezone) => {
      expect(
        createSocialPostRequestSchema.safeParse({
          text: "Hello",
          timezone,
        }).success,
      ).toBe(false);
    },
  );
});

describe("scheduleSocialPostRequestSchema timezone", () => {
  it("accepts an optional valid zone", () => {
    expect(
      scheduleSocialPostRequestSchema.safeParse({
        scheduledAt: FUTURE,
        revision: 0,
        timezone: "Europe/Prague",
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid zone", () => {
    expect(
      scheduleSocialPostRequestSchema.safeParse({
        scheduledAt: FUTURE,
        revision: 0,
        timezone: "Mars/Olympus",
      }).success,
    ).toBe(false);
  });
});
