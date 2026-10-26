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
  afterRender: vi.fn(),
}));
vi.mock("@sokosumi/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sokosumi/email")>();
  return {
    ...actual,
    renderNewsletterEmail: async (
      ...args: Parameters<typeof actual.renderNewsletterEmail>
    ) => {
      const rendered = await actual.renderNewsletterEmail(...args);
      await m.afterRender();
      return rendered;
    },
  };
});
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

let subscriber = pending();

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NEWSLETTER_NOW);
  m.enabled = true;
  subscriber = pending();
  m.findUnique.mockImplementation(async ({ where }) => {
    if (
      where.status &&
      (where.status !== subscriber.status ||
        subscriber.unsubscribedAt ||
        subscriber.bouncedAt ||
        subscriber.consentAt?.getTime() !== where.consentAt?.getTime() ||
        subscriber.welcomeSentAt ||
        subscriber.welcomeLeaseExpiresAt?.getTime() !==
          where.welcomeLeaseExpiresAt?.equals?.getTime() ||
        (subscriber.welcomeLeaseExpiresAt &&
          subscriber.welcomeLeaseExpiresAt <= new Date()) ||
        !subscriber.newsletter.welcomeEmailEnabled)
    )
      return null;
    return { ...subscriber };
  });
  m.updateMany.mockImplementation(async ({ where, data }) => {
    if (
      (where.status && where.status !== subscriber.status) ||
      (where.welcomeSentAt === null && subscriber.welcomeSentAt) ||
      (where.welcomeLeaseExpiresAt instanceof Date &&
        where.welcomeLeaseExpiresAt.getTime() !==
          subscriber.welcomeLeaseExpiresAt?.getTime()) ||
      (where.OR &&
        subscriber.welcomeLeaseExpiresAt &&
        subscriber.welcomeLeaseExpiresAt > new Date())
    )
      return { count: 0 };
    subscriber = { ...subscriber, ...data };
    return { count: 1 };
  });
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

  it("GET keeps a retry form available for an active subscriber with an unsent welcome", async () => {
    subscriber = pending({ status: "ACTIVE", confirmedAt: NEWSLETTER_NOW });
    const response = await app().request(url());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('method="post"');
    expect(m.updateMany).not.toHaveBeenCalled();
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
    expect(subscriber.welcomeSentAt).toEqual(NEWSLETTER_NOW);
    expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
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

  it.each(["UNSUBSCRIBED", "BOUNCED"])(
    "does not send a welcome when %s wins during rendering",
    async (status) => {
      m.afterRender.mockImplementation(async () => {
        m.findUnique.mockImplementation(async ({ where }) =>
          where.status === "ACTIVE" ? null : pending({ status }),
        );
      });
      expect((await app().request(url(), { method: "POST" })).status).toBe(200);
      expect(m.eventCreate).toHaveBeenCalledOnce();
      expect(m.afterRender).toHaveBeenCalledOnce();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it.each(["UNSUBSCRIBED", "BOUNCED", "PENDING"])(
    "does not claim confirmation when a concurrent %s state wins activation",
    async (status) => {
      m.updateMany.mockReset().mockResolvedValue({ count: 0 });
      m.findUnique.mockResolvedValueOnce(pending()).mockResolvedValue(
        pending({
          status,
          consentAt:
            status === "PENDING"
              ? new Date(NEWSLETTER_NOW.getTime() + 1)
              : NEWSLETTER_NOW,
        }),
      );
      const response = await app().request(url(), { method: "POST" });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(
        "Your subscription is confirmed",
      );
      expect(m.eventCreate).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it("does not send another welcome when a pending row has prior welcome delivery", async () => {
    subscriber = pending({
      confirmedAt: new Date("2026-10-01T00:00:00Z"),
      welcomeSentAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect((await app().request(url(), { method: "POST" })).status).toBe(200);
    expect(m.eventCreate).toHaveBeenCalledOnce();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("retries a failed welcome on re-confirmation and records provider acceptance only once", async () => {
    m.send.mockResolvedValueOnce({
      data: null,
      error: { name: "application_error", message: "test provider failure" },
    });
    const server = app();
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(subscriber.status).toBe("ACTIVE");
    expect(subscriber.confirmedAt).toEqual(NEWSLETTER_NOW);
    expect(subscriber.welcomeSentAt).toBeNull();
    expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
    expect(await (await server.request(url())).text()).toContain(
      'method="post"',
    );
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(subscriber.welcomeSentAt).toEqual(NEWSLETTER_NOW);
    expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(await (await server.request(url())).text()).not.toContain("<form");
    expect(m.eventCreate).toHaveBeenCalledOnce();
  });

  it("claims an unsent welcome once under concurrent active confirmations", async () => {
    subscriber = pending({ status: "ACTIVE", confirmedAt: NEWSLETTER_NOW });
    let finishSend = () => {};
    const started = new Promise<void>((resolveStarted) => {
      m.send.mockImplementationOnce(() => {
        resolveStarted();
        return new Promise((resolve) => {
          finishSend = () => resolve({ data: { id: "welcome" }, error: null });
        });
      });
    });
    const server = app();
    const first = server.request(url(), { method: "POST" });
    await started;
    expect(subscriber.welcomeSentAt).toBeNull();
    expect(subscriber.welcomeLeaseExpiresAt).toEqual(
      new Date(NEWSLETTER_NOW.getTime() + 5 * 60_000),
    );
    expect(m.updateMany).toHaveBeenCalledWith({
      where: {
        id: NEWSLETTER_SUBSCRIBER_ID,
        newsletterId: NEWSLETTER_ID,
        newsletter: {
          project: { workspace: { organization: { slug: "utxo" } } },
          welcomeEmailEnabled: true,
        },
        status: "ACTIVE",
        consentAt: NEWSLETTER_NOW,
        unsubscribedAt: null,
        bouncedAt: null,
        welcomeSentAt: null,
        OR: [
          { welcomeLeaseExpiresAt: null },
          { welcomeLeaseExpiresAt: { lte: NEWSLETTER_NOW } },
        ],
      },
      data: { welcomeLeaseExpiresAt: subscriber.welcomeLeaseExpiresAt },
    });
    expect(m.findUnique).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        status: "ACTIVE",
        consentAt: NEWSLETTER_NOW,
        unsubscribedAt: null,
        bouncedAt: null,
        welcomeSentAt: null,
        newsletter: {
          project: { workspace: { organization: { slug: "utxo" } } },
          welcomeEmailEnabled: true,
        },
        welcomeLeaseExpiresAt: {
          equals: subscriber.welcomeLeaseExpiresAt,
          gt: NEWSLETTER_NOW,
        },
      }),
      select: { id: true },
    });
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(subscriber.welcomeLeaseExpiresAt).not.toBeNull();
    expect(m.send).toHaveBeenCalledOnce();
    finishSend();
    expect((await first).status).toBe(200);
    expect(subscriber.welcomeSentAt).toEqual(NEWSLETTER_NOW);
    expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it("retries an interrupted welcome only after its lease expires", async () => {
    const leaseExpiresAt = new Date(NEWSLETTER_NOW.getTime() + 5 * 60_000);
    subscriber = pending({
      status: "ACTIVE",
      confirmedAt: NEWSLETTER_NOW,
      welcomeLeaseExpiresAt: leaseExpiresAt,
    });
    const server = app();
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
    expect(subscriber.welcomeLeaseExpiresAt).toEqual(leaseExpiresAt);
    vi.setSystemTime(leaseExpiresAt);
    expect((await server.request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).toHaveBeenCalledOnce();
    expect(subscriber.welcomeSentAt).toEqual(leaseExpiresAt);
    expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
  });

  it("does not release another confirmation's welcome lease", async () => {
    const newerLease = new Date(NEWSLETTER_NOW.getTime() + 6 * 60_000);
    m.afterRender.mockImplementation(async () => {
      subscriber = { ...subscriber, welcomeLeaseExpiresAt: newerLease };
    });
    expect((await app().request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
    expect(subscriber.welcomeLeaseExpiresAt).toEqual(newerLease);
  });

  it.each(["UNSUBSCRIBED", "BOUNCED"])(
    "does not retry a failed welcome after %s",
    async (status) => {
      m.send.mockRejectedValueOnce(new Error("test provider failure"));
      const server = app();
      expect((await server.request(url(), { method: "POST" })).status).toBe(
        200,
      );
      subscriber = {
        ...subscriber,
        status,
        ...(status === "UNSUBSCRIBED"
          ? { unsubscribedAt: NEWSLETTER_NOW }
          : { bouncedAt: NEWSLETTER_NOW }),
      };
      expect((await server.request(url(), { method: "POST" })).status).toBe(
        400,
      );
      expect(m.send).toHaveBeenCalledOnce();
      expect(subscriber.welcomeSentAt).toBeNull();
    },
  );

  it.each(["unsubscribedAt", "bouncedAt", "consentAt"])(
    "rechecks %s before retry dispatch",
    async (field) => {
      subscriber = pending({ status: "ACTIVE", confirmedAt: NEWSLETTER_NOW });
      m.afterRender.mockImplementation(async () => {
        subscriber = {
          ...subscriber,
          [field]: new Date(NEWSLETTER_NOW.getTime() + 1),
        };
      });
      expect((await app().request(url(), { method: "POST" })).status).toBe(200);
      expect(m.send).not.toHaveBeenCalled();
      expect(subscriber.welcomeSentAt).toBeNull();
      expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
    },
  );

  it("rechecks the feature flag before retry dispatch", async () => {
    subscriber = pending({ status: "ACTIVE", confirmedAt: NEWSLETTER_NOW });
    m.afterRender.mockImplementation(async () => {
      m.enabled = false;
    });
    expect((await app().request(url(), { method: "POST" })).status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
    expect(subscriber.welcomeLeaseExpiresAt).toBeNull();
  });

  it("keeps an already active subscription idempotent", async () => {
    m.findUnique.mockResolvedValue(
      pending({
        status: "ACTIVE",
        confirmedAt: NEWSLETTER_NOW,
        welcomeSentAt: NEWSLETTER_NOW,
      }),
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
    "does not confirm outside the project's beta organization on %s",
    async (method) => {
      m.findUnique.mockImplementation(async ({ where }) =>
        where.newsletter?.project?.workspace?.organization?.slug === "utxo"
          ? null
          : pending(),
      );
      expect((await app().request(url(), { method })).status).toBe(404);
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it.each(["unsubscribedAt", "bouncedAt"])(
    "never confirms pending rows with retained %s",
    async (field) => {
      m.findUnique.mockResolvedValue(pending({ [field]: NEWSLETTER_NOW }));
      expect((await app().request(url(), { method: "POST" })).status).toBe(400);
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
