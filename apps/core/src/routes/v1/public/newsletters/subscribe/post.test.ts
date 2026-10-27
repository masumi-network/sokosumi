import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import { verifyNewsletterConfirmToken } from "@/lib/newsletter/confirm-token";
import {
  NEWSLETTER,
  NEWSLETTER_ID,
  NEWSLETTER_NOW,
  NEWSLETTER_SUBSCRIBER,
  NEWSLETTER_WORKSPACE_ID,
} from "@/test/newsletter";

import router from "../index";

const m = vi.hoisted(() => ({
  domain: "news.example.com" as string | undefined,
  newsletter: vi.fn(),
  createMany: vi.fn(),
  subscriber: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
  contactChannel: vi.fn(),
  contactList: vi.fn(),
  contactListMember: vi.fn(),
  send: vi.fn(),
  redis: vi.fn(),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: m.send };
  },
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: () => ({ eval: m.redis }) }));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NEWSLETTER_FROM_DOMAIN: m.domain,
    }),
    getBetterAuthPublicBaseUrl: () => "https://core.example.com",
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletter: { findUnique: m.newsletter },
    newsletterSubscriber: {
      createMany: m.createMany,
      findUnique: m.subscriber,
      updateMany: m.updateMany,
    },
    newsletterEvent: { create: m.eventCreate },
    $transaction: m.transaction,
  },
}));

const URL = `http://localhost/v1/public/newsletters/${NEWSLETTER.publicSlug}/subscribe`;
const ACK = { status: "check_your_inbox" };

function app() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "newsletter_test");
    await next();
  });
  app.route("/v1/public/newsletters", router);
  app.onError(errorHandler);
  return app;
}

async function signup(body: Record<string, unknown> = {}) {
  const response = await app().request(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.1",
    },
    body: JSON.stringify({ email: "reader@example.com", ...body }),
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(ACK);
  return response;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NEWSLETTER_NOW);
  m.domain = "news.example.com";
  m.newsletter.mockResolvedValue(NEWSLETTER);
  m.createMany.mockResolvedValue({ count: 1 });
  m.subscriber.mockResolvedValue({
    ...NEWSLETTER_SUBSCRIBER,
    status: "PENDING",
    source: "SIGNUP_FORM",
  });
  m.updateMany.mockResolvedValue({ count: 1 });
  m.send.mockResolvedValue({ data: { id: "confirmation" }, error: null });
  m.redis.mockResolvedValue(1);
  m.contactChannel.mockResolvedValue({ contactId: "contact-1" });
  m.contactList.mockResolvedValue({ id: "list-1", smartFilter: null });
  const tx = {
    newsletterSubscriber: {
      createMany: m.createMany,
      findUnique: m.subscriber,
      updateMany: m.updateMany,
    },
    newsletterEvent: { create: m.eventCreate },
    contactChannel: { upsert: m.contactChannel },
    contactList: { upsert: m.contactList },
    contactListMember: { createMany: m.contactListMember },
  };
  m.transaction.mockImplementation(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});
afterEach(() => vi.useRealTimers());

describe("public newsletter signup", () => {
  it("creates pending consent, records SUBSCRIBED and sends a signed confirmation from the newsletter domain", async () => {
    await signup({
      email: " Reader@EXAMPLE.com ",
      name: "Ada",
      source: "SIGNUP_FORM",
      website: "",
    });
    expect(m.createMany).toHaveBeenCalledWith({
      data: {
        newsletterId: NEWSLETTER_ID,
        email: "reader@example.com",
        name: "Ada",
        status: "PENDING",
        source: "SIGNUP_FORM",
        consentAt: NEWSLETTER_NOW,
      },
      skipDuplicates: true,
    });
    expect(m.eventCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        newsletterId: NEWSLETTER_ID,
        subscriberId: NEWSLETTER_SUBSCRIBER.id,
        type: "SUBSCRIBED",
        occurredAt: NEWSLETTER_NOW,
      },
    });
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalledOnce();
    const [email] = m.send.mock.calls[0]!;
    expect(email).toMatchObject({
      to: "reader@example.com",
      from: '"Ada" <newsletter@news.example.com>',
      replyTo: "ada@example.com",
      subject: "Confirm your subscription to Weekly News",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    expect(email.html).toContain("Confirm subscription");
    expect(email.text).toContain("7 days");
    expect(email.headers["List-Unsubscribe"]).toContain(
      "https://core.example.com/v1/public/newsletter/unsubscribe?token=",
    );
    const link = email.html.match(
      /href="(https:\/\/core.example.com\/v1\/public\/newsletter\/confirm[^\"]+)"/,
    )?.[1];
    expect(link).toBeDefined();
    const token = new globalThis.URL(link!).searchParams.get("token")!;
    expect(verifyNewsletterConfirmToken(token, "test-secret")).toEqual({
      newsletterId: NEWSLETTER_ID,
      subscriberId: NEWSLETTER_SUBSCRIBER.id,
      consentAt: NEWSLETTER_NOW.getTime(),
    });
  });

  it("files the normalized email as a Contact on the newsletter's workspace list", async () => {
    await signup({ email: " Reader@EXAMPLE.com ", name: "Ada" });
    expect(m.contactChannel).toHaveBeenCalledExactlyOnceWith({
      where: {
        workspaceId_type_value: {
          workspaceId: NEWSLETTER_WORKSPACE_ID,
          type: "EMAIL",
          value: "reader@example.com",
        },
      },
      create: {
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        type: "EMAIL",
        value: "reader@example.com",
        source: "OTHER",
        isPrimary: true,
        contact: {
          create: { workspaceId: NEWSLETTER_WORKSPACE_ID, name: "Ada" },
        },
      },
      update: {},
      select: { contactId: true },
    });
    expect(m.contactList).toHaveBeenCalledExactlyOnceWith({
      where: {
        workspaceId_nameKey: {
          workspaceId: NEWSLETTER_WORKSPACE_ID,
          nameKey: "weekly news subscribers",
        },
      },
      create: {
        workspaceId: NEWSLETTER_WORKSPACE_ID,
        name: "Weekly News subscribers",
        nameKey: "weekly news subscribers",
        color: "gray",
      },
      update: {},
      select: { id: true, smartFilter: true },
    });
    expect(m.contactListMember).toHaveBeenCalledExactlyOnceWith({
      data: { listId: "list-1", contactId: "contact-1" },
      skipDuplicates: true,
    });
  });

  it("reuses a Contact owned by the email without overwriting its name", async () => {
    m.contactChannel.mockResolvedValue({ contactId: "existing-contact" });
    await signup({ name: "Untrusted replacement" });
    expect(m.contactChannel).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
    expect(m.contactListMember).toHaveBeenCalledWith({
      data: { listId: "list-1", contactId: "existing-contact" },
      skipDuplicates: true,
    });
  });

  it("retries a concurrent Contact insert before sending one confirmation", async () => {
    m.contactChannel.mockRejectedValueOnce({ code: "P2002" });
    await signup();
    expect(m.transaction).toHaveBeenCalledTimes(2);
    expect(m.eventCreate).toHaveBeenCalledOnce();
    expect(m.send).toHaveBeenCalledOnce();
  });

  it("keeps a smart-list name collision private without adding a member or sending mail", async () => {
    m.contactList.mockResolvedValue({
      id: "smart-list",
      smartFilter: { stages: ["CONTACT"] },
    });
    await signup();
    expect(m.contactListMember).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("does not send a confirmation after an unsubscribe wins before dispatch", async () => {
    m.subscriber
      .mockResolvedValueOnce({
        ...NEWSLETTER_SUBSCRIBER,
        status: "PENDING",
      })
      .mockResolvedValue(null);
    await signup();
    expect(m.send).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "Confirm your subscription to Weekly News"],
    ["de", "Bestätige dein Abonnement von Weekly News"],
    ["es", "Confirma tu suscripción a Weekly News"],
  ])("sends the confirmation in %s", async (locale, subject) => {
    await signup({ locale });
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ subject }));
  });

  it.each(["ACTIVE", "BOUNCED", "UNSUBSCRIBED"])(
    "does nothing for %s with the same acknowledgment",
    async (status) => {
      m.createMany.mockResolvedValue({ count: 0 });
      m.subscriber.mockResolvedValue({ ...NEWSLETTER_SUBSCRIBER, status });
      await signup();
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.eventCreate).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
      expect(m.contactChannel).not.toHaveBeenCalled();
    },
  );

  it("resends pending confirmations at most once per ten minutes", async () => {
    m.createMany.mockResolvedValue({ count: 0 });
    let consentAt = NEWSLETTER_NOW;
    m.subscriber.mockImplementation(async () => ({
      ...NEWSLETTER_SUBSCRIBER,
      status: "PENDING",
      consentAt,
    }));
    m.updateMany.mockImplementation(
      async ({ data }: { data: { consentAt: Date } }) => {
        consentAt = data.consentAt;
        return { count: 1 };
      },
    );
    await signup();
    vi.advanceTimersByTime(10 * 60_000 - 1);
    await signup();
    expect(m.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await signup();
    await signup();
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it.each(["unsubscribedAt", "bouncedAt"])(
    "honors retained %s even on a pending row",
    async (field) => {
      m.createMany.mockResolvedValue({ count: 0 });
      m.subscriber.mockResolvedValue({
        ...NEWSLETTER_SUBSCRIBER,
        status: "PENDING",
        consentAt: null,
        [field]: NEWSLETTER_NOW,
      });
      await signup();
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
      expect(m.eventCreate).not.toHaveBeenCalled();
      expect(m.contactChannel).not.toHaveBeenCalled();
    },
  );

  it("does not dispatch if a concurrent request already claimed the pending subscriber", async () => {
    m.createMany.mockResolvedValue({ count: 0 });
    m.subscriber.mockResolvedValue({
      ...NEWSLETTER_SUBSCRIBER,
      status: "PENDING",
      consentAt: null,
    });
    m.updateMany.mockResolvedValue({ count: 0 });
    await signup();
    expect(m.send).not.toHaveBeenCalled();
    expect(m.eventCreate).not.toHaveBeenCalled();
  });

  it.each(["https://example.com", " "])(
    "silently drops honeypot value %j",
    async (website) => {
      await signup({ website });
      expect(m.newsletter).not.toHaveBeenCalled();
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
    },
  );

  it("silently throttles by IP and newsletter", async () => {
    m.redis.mockResolvedValue(11);
    await signup();
    expect(m.redis).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `newsletter:signup:${NEWSLETTER_ID}:198.51.100.1`,
    );
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("keeps provider failures private", async () => {
    m.send.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        message: "test failure",
        statusCode: 422,
      },
    });
    await signup();
    expect(m.send).toHaveBeenCalledOnce();
  });

  it("never falls back to the product domain when newsletter sending is unconfigured", async () => {
    m.domain = undefined;
    await signup();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing newsletter", async () => {
    m.newsletter.mockResolvedValue(null);
    const response = await app().request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com" }),
    });
    expect(response.status).toBe(404);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("does not sign up readers outside the project's beta organization", async () => {
    m.newsletter.mockImplementation(async ({ where }) =>
      where.project?.workspace?.organization?.slug === "utxo"
        ? null
        : NEWSLETTER,
    );
    const response = await app().request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com" }),
    });
    expect(response.status).toBe(404);
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it.each([{ email: "invalid" }, { source: "API" }, { locale: "fr" }])(
    "validates public input %j",
    async (body) => {
      const response = await app().request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "reader@example.com", ...body }),
      });
      expect(response.status).toBe(422);
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );
});
