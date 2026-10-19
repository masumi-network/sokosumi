import { describe, expect, it } from "vitest";

import { isProjectAdProvider } from "./ads-providers";

describe("isProjectAdProvider", () => {
  it("accepts known providers", () => {
    expect(isProjectAdProvider("google_ads")).toBe(true);
    expect(isProjectAdProvider("meta_ads")).toBe(true);
  });

  it("rejects unknown providers, including inherited object keys", () => {
    expect(isProjectAdProvider("tiktok_ads")).toBe(false);
    expect(isProjectAdProvider("toString")).toBe(false);
  });
});
