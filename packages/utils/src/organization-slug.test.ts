import { afterEach, describe, expect, it, vi } from "vitest";

import { createOrganizationSlug } from "./organization-slug.js";

describe("createOrganizationSlug", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slugifies the name and appends a six-character suffix", () => {
    expect(createOrganizationSlug("Acme Studio & Co.")).toMatch(
      /^acme-studio-and-co-[a-z0-9]{6}$/,
    );
  });

  it("falls back to the suffix alone when the name has no slug characters", () => {
    expect(createOrganizationSlug("🚀")).toMatch(/^[a-z0-9]{6}$/);
  });

  it("gives two organizations with the same name different slugs", () => {
    expect(createOrganizationSlug("Acme")).not.toBe(
      createOrganizationSlug("Acme"),
    );
  });

  it("draws again instead of folding high bytes onto the first letters", () => {
    const batches = [
      [255, 254, 253, 252, 0, 1],
      [2, 3, 4, 5, 6, 7],
    ];
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).set(batches.shift() ?? []);
      return array;
    });

    expect(createOrganizationSlug("Acme")).toBe("acme-abcdef");
  });
});
