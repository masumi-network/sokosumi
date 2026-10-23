import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import { signNewsletterConfirmToken } from "@/lib/newsletter/confirm-token";
import {
  NEWSLETTER,
  NEWSLETTER_ID,
  NEWSLETTER_NOW,
  NEWSLETTER_SUBSCRIBER,
  NEWSLETTER_SUBSCRIBER_ID,
} from "@/test/newsletter";

import router from "../index";

const m = vi.hoisted(() => ({
  enabled: true,
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: m.send };
  },
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: m.enabled }),
    getBetterAuthPublicBaseUrl: () => "https://core.example.com",
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletterSubscriber: {
      findUnique: m.findUnique,
      updateMany: m.updateMany,
    },
    newsletterEvent: { create: m.eventCreate },
    $transaction: m.transaction,
  },
}));

function token() {
  return signNewsletterConfirmToken(
    {
      newsletterId: NEWSLETTER_ID,
      subscriberId: NEWSLETTER_SUBSCRIBER_ID,
      consentAt: NEWSLETTER_NOW.getTime(),
    },
    "test-secret",
  );
}
function url(value = token()) {
  return `http://localhost/v1/public/newsletter/confirm?token=${value}`;
}
function app() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "newsletter_test");
    await next();
  });
  app.route("/v1/public/newsletter", router);
  app.onError(errorHandler);
  return app;
}
function pending(overrides: Record<string, unknown> = {}) {
  return {
    ...NEWSLETTER_SUBSCRIBER,
    status: "PENDING",
    ...overrides,
    newsletter: {
      ...NEWSLETTER,
      brand: { primaryColor: "#123456", footerText: "Our footer" },
      welcomeEmailEnabled: true,
      welcomeSubject: "Welcome aboard",
      welcomeBody: "Hello **reader**",
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NEWSLETTER_NOW);
  m.enabled = true;
  m.findUnique.mockResolvedValue(pending());
  m.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValue({ count: 0 });
  m.send.mockResolvedValue({ data: { id: "welcome" }, error: null });
  const tx = {
    newsletterSubscriber: { updateMany: m.updateMany },
    newsletterEvent: { create: m.eventCreate },
  };
  m.transaction.mockImplementation(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});
afterEach(() => vi.useRealTimers());

describe("public newsletter confirmation", () => {
  it("GET renders a self-contained POST form without mutating or sending mail", async () => {
    const signed = token();
    const response = await app().request(url(signed));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "form-action 'self'",
    );
    const html = await response.text();
    expect(html).toContain("Confirm subscription");
    expect(html).toContain('method="post"');
    expect(html).toContain(`action="?token=${signed}"`);
    expect(html).not.toContain("<script");
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("POST activates and records CONFIRMED, with only one branded welcome under concurrent confirmation requests", async () => {
    const server = app();
    const responses = await Promise.all([
      server.request(url(), { method: "POST" }),
      server.request(url(), { method: "POST" }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Your subscription is confirmed");
      expect(html).not.toContain("<form");
    }
    expect(m.updateMany).toHaveBeenCalledWith({
      where: {
        id: NEWSLETTER_SUBSCRIBER_ID,
        newsletterId: NEWSLETTER_ID,
        status: "PENDING",
        consentAt: NEWSLETTER_NOW,
      },
      data: { status: "ACTIVE", confirmedAt: NEWSLETTER_NOW },
    });
    expect(m.eventCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        newsletterId: NEWSLETTER_ID,
        subscriberId: NEWSLETTER_SUBSCRIBER_ID,
        type: "CONFIRMED",
        occurredAt: NEWSLETTER_NOW,
      },
    });
    expect(m.send).toHaveBeenCalledOnce();
    const [email, options] = m.send.mock.calls[0]!;
    expect(email).toMatchObject({
      to: "reader@example.com",
      from: '"Ada" <newsletter@news.example.com>',
      replyTo: "ada@example.com",
      subject: "Welcome aboard",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    expect(email.html).toContain("#123456");
    expect(email.html).toContain("Our footer");
    expect(email.html).toContain("<strong>reader</strong>");
    expect(email.text).toContain(
      "https://core.example.com/v1/public/newsletter/unsubscribe?token=",
    );
    expect(email.headers["List-Unsubscribe"]).toContain(
      "/v1/public/newsletter/unsubscribe?token=",
    );
    expect(options).toEqual({
      idempotencyKey: `newsletter-welcome:${NEWSLETTER_SUBSCRIBER_ID}`,
    });
  });

  it("does not send a welcome when disabled", async () => {
    m.findUnique.mockResolvedValue({ ...pending(), newsletter: NEWSLETTER });
    expect((await app().request(url(), { method: "POST" })).status).toBe(200);
    expect(m.eventCreate).toHaveBeenCalledOnce();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("does not send another welcome on a fresh opt-in after prior confirmation", async () => {
    m.findUnique.mockResolvedValue(
      pending({ confirmedAt: new Date("2026-10-01T00:00:00Z") }),
    );
    expect((await app().request(url(), { method: "POST" })).status).toBe(200);
    expect(m.eventCreate).toHaveBeenCalledOnce();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("does not retry a welcome after a provider failure", async () => {
    m.send.mockRejectedValue(new Error("test provider failure"));
    const server = app();
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.eventCreate).toHaveBeenCalledOnce();
  });

  it("keeps an already active subscription idempotent", async () => {
    m.findUnique.mockResolvedValue(
      pending({ status: "ACTIVE", confirmedAt: NEWSLETTER_NOW }),
    );
    m.updateMany.mockReset().mockResolvedValue({ count: 0 });
    expect((await app().request(url(), { method: "POST" })).status).toBe(200);
    expect(m.eventCreate).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it.each(["UNSUBSCRIBED", "BOUNCED"])(
    "never activates a %s subscriber",
    async (status) => {
      m.findUnique.mockResolvedValue(pending({ status }));
      m.updateMany.mockReset().mockResolvedValue({ count: 0 });
      expect((await app().request(url(), { method: "POST" })).status).toBe(400);
      expect(m.eventCreate).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "POST"])(
    "rejects tampering, expiry and superseded consent on %s",
    async (method) => {
      const signed = token();
      expect((await app().request(url(`${signed}!`), { method })).status).toBe(
        400,
      );
      expect(m.findUnique).not.toHaveBeenCalled();
      vi.advanceTimersByTime(7 * 24 * 60 * 60_000);
      expect((await app().request(url(signed), { method })).status).toBe(400);
      expect(m.findUnique).not.toHaveBeenCalled();
      const fresh = token();
      m.findUnique.mockResolvedValue(
        pending({ consentAt: new Date(NEWSLETTER_NOW.getTime() + 1) }),
      );
      expect((await app().request(url(fresh), { method })).status).toBe(400);
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "POST"])(
    "returns 404 before token validation on %s when disabled",
    async (method) => {
      m.enabled = false;
      expect(
        (
          await app().request("http://localhost/v1/public/newsletter/confirm", {
            method,
          })
        ).status,
      ).toBe(404);
      expect(m.findUnique).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a deleted subscriber", async () => {
    m.findUnique.mockResolvedValue(null);
    expect((await app().request(url(), { method: "POST" })).status).toBe(404);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});
