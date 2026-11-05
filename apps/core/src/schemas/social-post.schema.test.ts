import { describe, expect, it } from "vitest";

import {
  createSocialPostRequestSchema,
  scheduleSocialPostRequestSchema,
  socialPostLastAttemptSchema,
  updateSocialPostRequestSchema,
} from "./social-post.schema";

const FUTURE = "2026-11-01T12:00:00.000Z";

describe.each([
  ["create", createSocialPostRequestSchema],
  ["update", updateSocialPostRequestSchema],
])("%s weighted request bounds", (_name, schema) => {
  it.each([
    ["post emoji", { text: "👨‍👩‍👧‍👦".repeat(12_500) }],
    [
      "first-comment emoji",
      { text: "Hi", firstComment: "👨‍👩‍👧‍👦".repeat(12_500) },
    ],
    [
      "first-comment URL",
      {
        text: "Hi",
        firstComment: `${"a".repeat(24_976)} https://example.com/long-path`,
      },
    ],
  ])("accepts 25,000 weighted X characters in %s", (_name, input) => {
    expect(schema.safeParse({ ...input, revision: 0 }).success).toBe(true);
  });

  it("rejects first comments exceeding every provider's limit", () => {
    expect(
      schema.safeParse({
        text: "Hi",
        firstComment: "a".repeat(25_001),
        revision: 0,
      }).success,
    ).toBe(false);
  });
});

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
