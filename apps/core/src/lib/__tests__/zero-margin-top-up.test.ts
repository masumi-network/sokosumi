import { describe, expect, it } from "vitest";

import { resolveZeroMarginTopUpLookupKey } from "../zero-margin-top-up";

describe("resolveZeroMarginTopUpLookupKey", () => {
  it("returns the zero-margin key for an allowlisted domain", () => {
    expect(resolveZeroMarginTopUpLookupKey("alice@nmkr.io")).toBe(
      "credit_0_margin",
    );
  });

  it("is case-insensitive on the domain", () => {
    expect(resolveZeroMarginTopUpLookupKey("alice@NMKR.IO")).toBe(
      "credit_0_margin",
    );
  });

  it("returns undefined for a non-allowlisted domain", () => {
    expect(resolveZeroMarginTopUpLookupKey("bob@example.com")).toBeUndefined();
  });

  it("returns undefined for null/empty/invalid email", () => {
    expect(resolveZeroMarginTopUpLookupKey(null)).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey(undefined)).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey("")).toBeUndefined();
    expect(resolveZeroMarginTopUpLookupKey("not-an-email")).toBeUndefined();
  });
});
