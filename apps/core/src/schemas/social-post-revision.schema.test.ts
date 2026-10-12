import { describe, expect, it } from "vitest";

import {
  cancelSocialPostRequestSchema,
  publishSocialPostRequestSchema,
} from "./social-post.schema";

describe("cancelSocialPostRequestSchema", () => {
  it("requires a non-negative revision", () => {
    expect(
      cancelSocialPostRequestSchema.safeParse({ revision: 0 }).success,
    ).toBe(true);
    expect(
      cancelSocialPostRequestSchema.safeParse({ revision: 3 }).success,
    ).toBe(true);
    expect(cancelSocialPostRequestSchema.safeParse({}).success).toBe(false);
    expect(
      cancelSocialPostRequestSchema.safeParse({ revision: -1 }).success,
    ).toBe(false);
  });
});

describe("publishSocialPostRequestSchema", () => {
  it("requires a non-negative revision", () => {
    expect(
      publishSocialPostRequestSchema.safeParse({ revision: 1 }).success,
    ).toBe(true);
    expect(publishSocialPostRequestSchema.safeParse({}).success).toBe(false);
    expect(
      publishSocialPostRequestSchema.safeParse({ revision: 1.5 }).success,
    ).toBe(false);
  });
});
