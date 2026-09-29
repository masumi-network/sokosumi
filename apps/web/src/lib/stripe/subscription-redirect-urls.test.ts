import { describe, expect, it } from "vitest";

import {
  buildSubscriptionStatusPath,
  isStripeCheckoutSessionId,
  withCheckoutSessionIdPlaceholder,
} from "./subscription-redirect-urls";

describe("buildSubscriptionStatusPath", () => {
  it("adds the status to an existing query", () => {
    expect(
      buildSubscriptionStatusPath("/billing?tab=subscription", "success"),
    ).toBe("/billing?tab=subscription&status=success");
  });
});

describe("withCheckoutSessionIdPlaceholder", () => {
  it("appends the Stripe template with literal braces", () => {
    expect(
      withCheckoutSessionIdPlaceholder(
        "https://app.sokosumi.com/billing?tab=subscription&status=success",
      ),
    ).toBe(
      "https://app.sokosumi.com/billing?tab=subscription&status=success&checkout_session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("starts a query when the URL has none", () => {
    expect(
      withCheckoutSessionIdPlaceholder("https://app.sokosumi.com/billing"),
    ).toBe(
      "https://app.sokosumi.com/billing?checkout_session_id={CHECKOUT_SESSION_ID}",
    );
  });

  // Mirrors Better Auth's Stripe plugin (1.7.6): it encodes our URL into its
  // own `/subscription/success?callbackURL=…&checkoutSessionId={CHECKOUT_SESSION_ID}`,
  // Stripe fills only the outer literal template, and the plugin then decodes
  // `callbackURL` and runs `replaceAll("{CHECKOUT_SESSION_ID}", checkoutSessionId)`.
  it("survives the Better Auth success hop", () => {
    const successUrl = withCheckoutSessionIdPlaceholder(
      "https://app.sokosumi.com/billing?tab=subscription&status=success",
    );
    const pluginSuccessUrl = `https://api.sokosumi.com/auth/subscription/success?callbackURL=${encodeURIComponent(successUrl)}&checkoutSessionId={CHECKOUT_SESSION_ID}`;
    const stripeRedirect = pluginSuccessUrl.replaceAll(
      "{CHECKOUT_SESSION_ID}",
      "cs_test_abc",
    );
    const query = new URL(stripeRedirect).searchParams;
    const callbackURL = (query.get("callbackURL") ?? "").replaceAll(
      "{CHECKOUT_SESSION_ID}",
      query.get("checkoutSessionId") ?? "",
    );

    expect(new URL(callbackURL).searchParams.get("checkout_session_id")).toBe(
      "cs_test_abc",
    );
  });
});

describe("isStripeCheckoutSessionId", () => {
  it("accepts Stripe checkout session ids", () => {
    expect(isStripeCheckoutSessionId("cs_test_a1B2")).toBe(true);
    expect(isStripeCheckoutSessionId("cs_live_a1B2")).toBe(true);
  });

  it("rejects missing values and the raw template", () => {
    expect(isStripeCheckoutSessionId(undefined)).toBe(false);
    expect(isStripeCheckoutSessionId("{CHECKOUT_SESSION_ID}")).toBe(false);
    expect(isStripeCheckoutSessionId("cs_../../x")).toBe(false);
  });
});
