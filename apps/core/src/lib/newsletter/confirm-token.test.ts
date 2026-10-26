import { afterEach, describe, expect, it, vi } from "vitest";

import { NEWSLETTER_ID, NEWSLETTER_SUBSCRIBER_ID } from "@/test/newsletter";

import {
  signNewsletterConfirmToken,
  verifyNewsletterConfirmToken,
} from "./confirm-token";
import { newsletterTokenSignature } from "./token";
import {
  signNewsletterUnsubscribeToken,
  verifyNewsletterUnsubscribeToken,
} from "./unsubscribe-token";

const SECRET = "test-newsletter-server-secret";
const NOW = new Date("2026-10-23T10:00:00Z");
const CLAIMS = {
  newsletterId: NEWSLETTER_ID,
  subscriberId: NEWSLETTER_SUBSCRIBER_ID,
  consentAt: NOW.getTime(),
};

afterEach(() => vi.useRealTimers());

describe("newsletter confirmation tokens", () => {
  it("round-trips claims and expires after seven days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const token = signNewsletterConfirmToken(CLAIMS, SECRET);
    expect(verifyNewsletterConfirmToken(token, SECRET)).toEqual(CLAIMS);
    vi.advanceTimersByTime(7 * 24 * 60 * 60_000 - 1);
    expect(verifyNewsletterConfirmToken(token, SECRET)).toEqual(CLAIMS);
    vi.advanceTimersByTime(1);
    expect(() => verifyNewsletterConfirmToken(token, SECRET)).toThrow(
      "Invalid or expired confirmation token",
    );
  });

  it("rejects tampered claims, signatures, malformed tokens and wrong secrets", () => {
    const token = signNewsletterConfirmToken(CLAIMS, SECRET);
    for (const invalid of [
      token.replace(NEWSLETTER_ID, NEWSLETTER_SUBSCRIBER_ID),
      token.replace(NEWSLETTER_SUBSCRIBER_ID, NEWSLETTER_ID),
      token.replace(String(CLAIMS.consentAt), "0"),
      `${token.slice(0, -1)}!`,
      `${token}.extra`,
      "v1.bad.bad.0.NaN.signature",
      "",
      "x".repeat(513),
    ]) {
      expect(() => verifyNewsletterConfirmToken(invalid, SECRET)).toThrow(
        "Invalid or expired confirmation token",
      );
    }
    expect(() => verifyNewsletterConfirmToken(token, "wrong-secret")).toThrow();
  });

  it("keeps confirmation and unsubscribe purposes separate", () => {
    const confirm = signNewsletterConfirmToken(CLAIMS, SECRET);
    const unsubscribe = signNewsletterUnsubscribeToken(CLAIMS, SECRET);
    expect(() => verifyNewsletterConfirmToken(unsubscribe, SECRET)).toThrow();
    expect(() => verifyNewsletterUnsubscribeToken(confirm, SECRET)).toThrow();
    const payload = confirm.split(".").slice(0, -1).join(".");
    const wrongPurpose = `${payload}.${newsletterTokenSignature(payload, "unsubscribe", SECRET)}`;
    expect(() => verifyNewsletterConfirmToken(wrongPurpose, SECRET)).toThrow();
  });
});
