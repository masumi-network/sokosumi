import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NEWSLETTER,
  NEWSLETTER_ID,
  NEWSLETTER_SUBSCRIBER_ID,
} from "@/test/newsletter";

import {
  newsletterPublicUrl,
  newsletterSenderOptions,
  newsletterUnsubscribeOptions,
} from "./email";
import { verifyNewsletterUnsubscribeToken } from "./unsubscribe-token";

const m = vi.hoisted(() => ({
  domain: "news.example.com" as string | undefined,
  baseUrl: "https://core.example.com",
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_FROM_DOMAIN: m.domain }),
    getBetterAuthPublicBaseUrl: () => m.baseUrl,
  };
});

beforeEach(() => {
  m.domain = "news.example.com";
  m.baseUrl = "https://core.example.com";
});

describe("newsletter email configuration", () => {
  it("uses only the newsletter domain and strips sender header delimiters", () => {
    expect(
      newsletterSenderOptions({
        senderName: 'Ada"\\\r\nTest',
        replyTo: "ada@example.com",
      }),
    ).toEqual({
      from: '"Ada    Test" <newsletter@news.example.com>',
      replyTo: "ada@example.com",
    });
  });

  it("refuses to fall back to the product domain", () => {
    m.domain = undefined;
    expect(() => newsletterSenderOptions(NEWSLETTER)).toThrow(
      "NEWSLETTER_FROM_DOMAIN",
    );
  });

  it.each(["confirm", "unsubscribe"] as const)(
    "requires public HTTPS for %s links",
    (action) => {
      expect(newsletterPublicUrl(action).href).toBe(
        `https://core.example.com/v1/public/newsletter/${action}`,
      );
      m.baseUrl = "http://localhost:8787";
      expect(() => newsletterPublicUrl(action)).toThrow("public HTTPS");
    },
  );

  it("shares signed unsubscribe links and RFC 8058 headers", () => {
    const claims = {
      newsletterId: NEWSLETTER_ID,
      subscriberId: NEWSLETTER_SUBSCRIBER_ID,
    };
    const { unsubscribeUrl, headers } = newsletterUnsubscribeOptions(claims);
    expect(headers).toEqual({
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const token = new URL(unsubscribeUrl).searchParams.get("token")!;
    expect(verifyNewsletterUnsubscribeToken(token, "test-secret")).toEqual(
      claims,
    );
  });
});
