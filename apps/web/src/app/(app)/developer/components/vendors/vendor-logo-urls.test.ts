import type { VendorMembership } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { getVendorLogoUrls } from "./vendor-logo-urls";

function vendor(logos: { light: string | null; dark: string | null }) {
  return { logos } as VendorMembership;
}

describe("getVendorLogoUrls", () => {
  it("uses each theme's own logo when both exist", () => {
    expect(
      getVendorLogoUrls(vendor({ light: "/black.svg", dark: "/white.svg" })),
    ).toEqual({ light: "/black.svg", dark: "/white.svg" });
  });

  it("falls back to the other logo when a theme has none", () => {
    expect(
      getVendorLogoUrls(vendor({ light: "/only.svg", dark: null })),
    ).toEqual({ light: "/only.svg", dark: "/only.svg" });
    expect(
      getVendorLogoUrls(vendor({ light: null, dark: "/only.svg" })),
    ).toEqual({ light: "/only.svg", dark: "/only.svg" });
  });

  it("returns no logo when the vendor has none", () => {
    expect(getVendorLogoUrls(vendor({ light: null, dark: null }))).toEqual({
      light: undefined,
      dark: undefined,
    });
  });
});
