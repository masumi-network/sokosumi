import { describe, expect, it } from "vitest";

import { isAllowedStripeBillingPortalUrl } from "./stripe-billing-portal-url";

describe("isAllowedStripeBillingPortalUrl", () => {
  it("allows Stripe billing portal URLs", () => {
    expect(
      isAllowedStripeBillingPortalUrl(
        "https://billing.stripe.com/p/session/test_123",
      ),
    ).toBe(true);
  });

  it("rejects non-Stripe hosts", () => {
    expect(isAllowedStripeBillingPortalUrl("https://evil.com/phish")).toBe(
      false,
    );
  });

  it("rejects non-https URLs", () => {
    expect(
      isAllowedStripeBillingPortalUrl("http://billing.stripe.com/session/test"),
    ).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isAllowedStripeBillingPortalUrl("not-a-url")).toBe(false);
  });
});
