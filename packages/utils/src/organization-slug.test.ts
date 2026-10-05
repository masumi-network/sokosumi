import { describe, expect, it } from "vitest";

import { createOrganizationSlug } from "./organization-slug.js";

describe("createOrganizationSlug", () => {
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
});
