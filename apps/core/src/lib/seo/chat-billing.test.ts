import { describe, expect, it } from "vitest";

import { seoChatUsage } from "./chat-billing";

describe("SEO chat Gateway billing price", () => {
  it("rejects missing or malformed prices instead of reporting free usage", () => {
    for (const cost of [undefined, null, "", " ", "bad", -1, NaN, Infinity]) {
      expect(() =>
        seoChatUsage({ providerMetadata: { gateway: { cost } } }),
      ).toThrow("SEO chat usage price is unavailable");
    }
    expect(() => seoChatUsage({})).toThrow();
  });

  it("keeps explicit zero and fractional prices with token usage", () => {
    expect(
      seoChatUsage({
        providerMetadata: { gateway: { cost: "0.001234" } },
        usage: { inputTokens: { total: 42, cacheRead: 12 }, outputTokens: 7 },
      }),
    ).toEqual({
      costUsd: 0.001234,
      inputTokens: 42,
      outputTokens: 7,
      cacheReadTokens: 12,
      cacheWriteTokens: 0,
    });
    expect(
      seoChatUsage({ providerMetadata: { gateway: { cost: 0 } } }).costUsd,
    ).toBe(0);
  });
});
