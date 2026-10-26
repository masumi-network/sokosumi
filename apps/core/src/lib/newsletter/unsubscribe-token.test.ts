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
