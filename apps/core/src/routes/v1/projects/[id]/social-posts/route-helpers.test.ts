import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { notFound } from "@/helpers/error";

import { mapSocialPostServiceError } from "./route-helpers";

describe("mapSocialPostServiceError", () => {
  it("rethrows an HTTPException unchanged", () => {
    const error = notFound("Social post not found");
    try {
      mapSocialPostServiceError(error);
      expect.unreachable();
    } catch (mapped) {
      expect(mapped).toBe(error);
    }
  });

  it("wraps an unknown failure as an internal error", () => {
    try {
      mapSocialPostServiceError(new Error("prisma down"));
      expect.unreachable();
    } catch (mapped) {
      expect(mapped).toBeInstanceOf(HTTPException);
      expect((mapped as HTTPException).status).toBe(500);
      expect((mapped as HTTPException).message).toBe(
        "Unable to manage social posts.",
      );
    }
  });
});
