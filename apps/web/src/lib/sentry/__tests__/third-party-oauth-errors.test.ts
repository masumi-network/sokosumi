import { describe, expect, it } from "vitest";

import { createErrorEvent } from "@/lib/sentry/__tests__/error-event-fixture";
import {
  isMinifiedOAuthRejectionNoise,
  isMinifiedOAuthRejectionNoiseMessage,
} from "@/lib/sentry/third-party-oauth-errors";

describe("isMinifiedOAuthRejectionNoise", () => {
  it("drops minified Aa rejections on auth routes without a stack", () => {
    expect(
      isMinifiedOAuthRejectionNoise(
        createErrorEvent({
          transaction: "/auth/google",
          exception: {
            values: [{ type: "Error", value: "Aa" }],
          },
        }),
        "Aa",
      ),
    ).toBe(true);
  });

  it("drops minified Aa rejections on agents without a stack", () => {
    expect(
      isMinifiedOAuthRejectionNoiseMessage(
        createErrorEvent({
          transaction: "/agents",
          exception: {
            values: [{ type: "Error", value: "Aa" }],
          },
        }),
      ),
    ).toBe(true);
  });

  it("keeps minified Aa rejections when a stack is present", () => {
    expect(
      isMinifiedOAuthRejectionNoise(
        createErrorEvent({
          transaction: "/auth/google",
          exception: {
            values: [
              {
                type: "Error",
                value: "Aa",
                stacktrace: {
                  frames: [{ filename: "app:///_next/static/chunks/page.js" }],
                },
              },
            ],
          },
        }),
        "Aa",
      ),
    ).toBe(false);
  });

  it("keeps unrelated short errors on non-auth routes", () => {
    expect(
      isMinifiedOAuthRejectionNoise(
        createErrorEvent({
          transaction: "/tasks",
          exception: {
            values: [{ type: "Error", value: "Aa" }],
          },
        }),
        "Aa",
      ),
    ).toBe(false);
  });
});
