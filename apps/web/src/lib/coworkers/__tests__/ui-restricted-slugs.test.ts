import { describe, expect, it } from "vitest";

import {
  filterCoworkersForUiListing,
  isUiRestrictedCoworkerSlug,
  normalizeCoworkerSlug,
} from "@/lib/coworkers/ui-restricted-slugs";

describe("ui-restricted coworker slugs", () => {
  it("normalizes coworker slugs for comparisons", () => {
    expect(normalizeCoworkerSlug(" Hermes ")).toBe("hermes");
  });

  it("matches restricted slugs case-insensitively", () => {
    expect(isUiRestrictedCoworkerSlug("hermes")).toBe(true);
    expect(isUiRestrictedCoworkerSlug("Hermes")).toBe(true);
  });

  it("does not restrict other or missing slugs", () => {
    expect(isUiRestrictedCoworkerSlug("hannah")).toBe(false);
    expect(isUiRestrictedCoworkerSlug("")).toBe(false);
    expect(isUiRestrictedCoworkerSlug(null)).toBe(false);
    expect(isUiRestrictedCoworkerSlug(undefined)).toBe(false);
  });

  it("filters restricted coworkers from UI listings", () => {
    const coworkers = [
      { id: "cow-1", slug: "hannah" },
      { id: "cow-2", slug: "HERMES" },
      { id: "cow-3", slug: null },
    ];

    expect(filterCoworkersForUiListing(coworkers)).toEqual([
      { id: "cow-1", slug: "hannah" },
      { id: "cow-3", slug: null },
    ]);
  });
});
