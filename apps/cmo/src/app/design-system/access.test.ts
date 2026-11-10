import { describe, expect, it } from "vitest";

import { isDesignSystemPublic } from "./access";

describe("isDesignSystemPublic", () => {
  it("hides the page on Vercel production", () => {
    expect(isDesignSystemPublic({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("shows the page on Vercel preview and development", () => {
    expect(isDesignSystemPublic({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isDesignSystemPublic({ VERCEL_ENV: "development" })).toBe(true);
  });

  it("hides the page on a non-Vercel production host", () => {
    expect(isDesignSystemPublic({ NODE_ENV: "production" })).toBe(false);
  });

  it("shows the page in local development without VERCEL_ENV", () => {
    expect(isDesignSystemPublic({ NODE_ENV: "development" })).toBe(true);
    expect(isDesignSystemPublic({})).toBe(true);
  });
});
