import { describe, expect, it } from "vitest";

import { MARKET_KEYWORD_LIMIT, MARKET_KEYWORD_MAX_LENGTH } from "./market";

describe("market profile limits", () => {
  it("come from Core's schema", () => {
    expect(MARKET_KEYWORD_LIMIT).toBe(10);
    expect(MARKET_KEYWORD_MAX_LENGTH).toBe(80);
  });
});
