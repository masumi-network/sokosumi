import { describe, expect, it } from "vitest";

import { LIMITS } from "@/config/constants";

import { createVendorRequestSchema, vendorSchema } from "./vendor.schema";

describe("vendor logo schemas", () => {
  it("caps input logos but accepts longer stored logos in responses", () => {
    const longLogo = "x".repeat(LIMITS.VENDOR_LOGO_MAX_LENGTH + 1);

    expect(
      createVendorRequestSchema.safeParse({
        name: "Acme",
        slug: "acme",
        logos: { light: longLogo },
      }).success,
    ).toBe(false);

    expect(
      vendorSchema.parse({
        id: "vendor-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        name: "Acme",
        slug: "acme",
        logos: { light: longLogo, dark: null },
      }).logos.light,
    ).toBe(longLogo);
  });
});
