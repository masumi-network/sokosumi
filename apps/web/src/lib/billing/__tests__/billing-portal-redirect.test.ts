import { describe, expect, it } from "vitest";

import {
  buildBillingPortalRedirectPath,
  isAllowedBillingPortalNavigation,
} from "../billing-portal-redirect";

describe("buildBillingPortalRedirectPath", () => {
  it("builds a personal billing portal redirect path", () => {
    expect(
      buildBillingPortalRedirectPath({
        returnPath: "/account",
      }),
    ).toBe("/api/billing/portal?returnPath=%2Faccount");
  });

  it("includes organizationId for organization billing portals", () => {
    expect(
      buildBillingPortalRedirectPath({
        organizationId: "org-1",
        returnPath: "/organizations/acme",
      }),
    ).toBe(
      "/api/billing/portal?returnPath=%2Forganizations%2Facme&organizationId=org-1",
    );
  });
});

describe("isAllowedBillingPortalNavigation", () => {
  it("allows same-origin and direct navigation", () => {
    expect(isAllowedBillingPortalNavigation("same-origin")).toBe(true);
    expect(isAllowedBillingPortalNavigation("same-site")).toBe(true);
    expect(isAllowedBillingPortalNavigation("none")).toBe(true);
    expect(isAllowedBillingPortalNavigation(null)).toBe(true);
  });

  it("blocks cross-site navigation", () => {
    expect(isAllowedBillingPortalNavigation("cross-site")).toBe(false);
  });
});
