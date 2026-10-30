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
  it("sends from the project's verified address under the sender name", () => {
    expect(
      newsletterSenderOptions(
        { senderName: 'Ada"\\\r\nTest', replyTo: "ada@example.com" },
        { fromAddress: "news@brand.example", status: "VERIFIED" },
      ),
    ).toEqual({
      from: '"Ada    Test" <news@brand.example>',
      replyTo: "ada@example.com",
    });
  });

  it.each(["PENDING", "FAILED"] as const)(
    "falls back to the shared domain via Sokosumi while the domain is %s",
    (status) => {
      expect(
        newsletterSenderOptions(NEWSLETTER, {
          fromAddress: "news@brand.example",
          status,
        }),
      ).toEqual({
        from: `"${NEWSLETTER.senderName} via Sokosumi" <newsletter@news.example.com>`,
        replyTo: NEWSLETTER.replyTo,
      });
    },
  );

  it("falls back to the shared domain without a sending domain", () => {
    expect(newsletterSenderOptions(NEWSLETTER, null).from).toBe(
      `"${NEWSLETTER.senderName} via Sokosumi" <newsletter@news.example.com>`,
    );
  });

  it("refuses to fall back to the product domain", () => {
    m.domain = undefined;
    expect(() => newsletterSenderOptions(NEWSLETTER, null)).toThrow(
      expect.objectContaining({
        status: 409,
        message: expect.stringContaining("sending domain"),
      }),
    );
    expect(() =>
      newsletterSenderOptions(NEWSLETTER, {
        fromAddress: "news@brand.example",
        status: "PENDING",
      }),
    ).toThrow("sending domain");
  });

  it("needs no shared domain once the project domain is verified", () => {
    m.domain = undefined;
    expect(
      newsletterSenderOptions(NEWSLETTER, {
        fromAddress: "news@brand.example",
        status: "VERIFIED",
      }).from,
    ).toBe(`"${NEWSLETTER.senderName}" <news@brand.example>`);
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
