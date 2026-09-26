import { describe, expect, it } from "vitest";

/**
 * Which token-mint failures hide the chat.
 *
 * An independent review confirmed that 500, 502, 429 and a 503 without a
 * `Retry-After` header all disabled the composer until the page was reloaded —
 * including the mint route's own "Core did not answer", which is the most
 * ordinary failure there is.
 *
 * This exercises the component's own classifier, not a copy of it.
 */

import { classifyTokenFailure } from "./studio-chat";

describe("token failure classification", () => {
  it.each([
    ["the feature is not configured", 503, "not_configured"],
    ["the session is gone", 401, "unauthorized"],
    ["the project is not visible", 404, "not_found"],
  ])("replaces the composer when %s", (_why, status, code) => {
    expect(classifyTokenFailure(status, code)).toBe("unavailable");
  });

  it.each([
    ["Core did not answer", 503, "temporarily_unavailable"],
    ["a gateway error", 502, undefined],
    ["an internal error", 500, undefined],
    ["rate limiting", 429, undefined],
  ])("offers a retry on %s", (_why, status, code) => {
    expect(classifyTokenFailure(status, code)).toBe("transient");
  });

  it("offers a retry for a 503 with no Retry-After header", () => {
    // The header was the old signal, and the route's normal failure path did
    // not set it — so the most common transient case was treated as fatal.
    expect(classifyTokenFailure(503, undefined)).toBe("transient");
  });
});
