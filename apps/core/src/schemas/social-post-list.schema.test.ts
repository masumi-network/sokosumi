import { describe, expect, it } from "vitest";

import { listSocialPostsQuerySchema } from "./social-post.schema";

describe("listSocialPostsQuerySchema status", () => {
  it("leaves status unset when the query omits it", () => {
    const result = listSocialPostsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBeUndefined();
  });

  it("parses a comma-separated list and trims entries", () => {
    const result = listSocialPostsQuerySchema.safeParse({
      status: " DRAFT , SCHEDULED ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toEqual(["DRAFT", "SCHEDULED"]);
    }
  });

  it.each(["", ",", "NOPE", "DRAFT,NOPE"])("rejects %s", (status) => {
    expect(listSocialPostsQuerySchema.safeParse({ status }).success).toBe(
      false,
    );
  });
});
