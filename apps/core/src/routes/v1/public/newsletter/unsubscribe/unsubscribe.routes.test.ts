import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import { signNewsletterUnsubscribeToken } from "@/lib/newsletter/unsubscribe-token";
import {
  NEWSLETTER,
  NEWSLETTER_ID,
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
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NEWSLETTER_ENABLED: m.enabled }),
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

const TOKEN = signNewsletterUnsubscribeToken(
  { newsletterId: NEWSLETTER_ID, subscriberId: NEWSLETTER_SUBSCRIBER_ID },
  "test-secret",
);
const URL = `http://localhost/v1/public/newsletter/unsubscribe?token=${TOKEN}`;

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

beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.findUnique.mockResolvedValue({
    ...NEWSLETTER_SUBSCRIBER,
    newsletter: NEWSLETTER,
  });
  m.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValue({ count: 0 });
  const tx = {
    newsletterSubscriber: { updateMany: m.updateMany },
    newsletterEvent: { create: m.eventCreate },
  };
  m.transaction.mockImplementation(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});

describe("public newsletter unsubscribe", () => {
  it.each([
    ["de", "Abmeldung bestätigen"],
    ["es", "Confirmar cancelación de suscripción"],
  ])("uses the request locale for %s", async (locale, title) => {
    const response = await app().request(URL, {
      headers: { "Accept-Language": locale },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(title);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "renders a no-auth GET confirmation without mutating data when enabled=%s",
    async (enabled) => {
      m.enabled = enabled;
      const response = await app().request(URL);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain("Confirm unsubscribe");
      expect(html).toContain('method="post"');
      expect(html).toContain(TOKEN);
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.eventCreate).not.toHaveBeenCalled();
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "POST unsubscribes idempotently when enabled=%s",
    async (enabled) => {
      m.enabled = enabled;
      const server = app();
      for (let i = 0; i < 2; i++) {
        const response = await server.request(URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("You are unsubscribed");
      }
      expect(m.updateMany).toHaveBeenCalledWith({
        where: {
          id: NEWSLETTER_SUBSCRIBER_ID,
          newsletterId: NEWSLETTER_ID,
          status: { not: "UNSUBSCRIBED" },
        },
        data: { status: "UNSUBSCRIBED", unsubscribedAt: expect.any(Date) },
      });
      expect(m.eventCreate).toHaveBeenCalledExactlyOnceWith({
        data: {
          newsletterId: NEWSLETTER_ID,
          subscriberId: NEWSLETTER_SUBSCRIBER_ID,
          type: "UNSUBSCRIBED",
          occurredAt: expect.any(Date),
        },
      });
    },
  );

  it("accepts the plain confirmation form POST without a body", async () => {
    expect((await app().request(URL, { method: "POST" })).status).toBe(200);
    expect(m.eventCreate).toHaveBeenCalledOnce();
  });

  it.each(["GET", "POST"])(
    "rejects a missing token for %s while disabled",
    async (method) => {
      m.enabled = false;
      expect(
        (
          await app().request(
            "http://localhost/v1/public/newsletter/unsubscribe",
            { method },
          )
        ).status,
      ).toBe(422);
      expect(m.findUnique).not.toHaveBeenCalled();
      expect(m.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "POST"])(
    "rejects tampered tokens for %s without data access",
    async (method) => {
      m.enabled = false;
      expect((await app().request(`${URL}!`, { method })).status).toBe(400);
      expect(m.findUnique).not.toHaveBeenCalled();
      expect(m.updateMany).not.toHaveBeenCalled();
    },
  );

  it("rejects a token for a deleted subscriber", async () => {
    m.findUnique.mockResolvedValue(null);
    expect((await app().request(URL, { method: "POST" })).status).toBe(404);
    expect(m.eventCreate).not.toHaveBeenCalled();
  });
});
