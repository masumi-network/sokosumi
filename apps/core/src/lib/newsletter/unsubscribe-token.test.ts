import { describe, expect, it } from "vitest";

import { NEWSLETTER_ID, NEWSLETTER_SUBSCRIBER_ID } from "@/test/newsletter";

import {
  signNewsletterUnsubscribeToken,
  verifyNewsletterUnsubscribeToken,
} from "./unsubscribe-token";

const SECRET = "test-newsletter-server-secret";
const CLAIMS = {
  newsletterId: NEWSLETTER_ID,
  subscriberId: NEWSLETTER_SUBSCRIBER_ID,
};

describe("newsletter unsubscribe tokens", () => {
  it("round-trips subscriber and newsletter with a server secret", () => {
    const token = signNewsletterUnsubscribeToken(CLAIMS, SECRET);
    expect(token).toBe(
      "v1.33333333-3333-4333-8333-333333333333.55555555-5555-4555-8555-555555555555.uGred6DO7U93nkth65m93-dE39XfCvwaHU4GGyBWR5E",
    );
    expect(verifyNewsletterUnsubscribeToken(token, SECRET)).toEqual(CLAIMS);
    expect(() =>
      verifyNewsletterUnsubscribeToken(token, "wrong-secret"),
    ).toThrow("Invalid unsubscribe token");
  });

  it("rejects tampered claims and signatures", () => {
    const token = signNewsletterUnsubscribeToken(CLAIMS, SECRET);
    for (const invalid of [
      token.replace(NEWSLETTER_ID, NEWSLETTER_SUBSCRIBER_ID),
      token.replace(NEWSLETTER_SUBSCRIBER_ID, NEWSLETTER_ID),
      `${token.slice(0, -1)}!`,
      `${token}.extra`,
      "",
      "v1.bad.bad.signature",
      "x".repeat(513),
    ]) {
      expect(() => verifyNewsletterUnsubscribeToken(invalid, SECRET)).toThrow(
        "Invalid unsubscribe token",
      );
    }
  });
});
