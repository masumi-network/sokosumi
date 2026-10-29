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
} from "@/test/newsletter";

import router from "../index";

const m = vi.hoisted(() => ({
  domain: "news.example.com" as string | undefined,
  newsletter: vi.fn(),
  createMany: vi.fn(),
  subscriber: vi.fn(),
  pending: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  contactCreateMany: vi.fn(),
  channelCreateMany: vi.fn(),
  listCreate: vi.fn(),
  listMembers: vi.fn(),
  newsletterUpdate: vi.fn(),
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
      findMany: m.pending,
      updateMany: m.updateMany,
      update: m.update,
    },
    newsletterEvent: { create: m.eventCreate },
    $transaction: m.transaction,
  },
}));

const URL = `http://localhost/v1/public/newsletters/${NEWSLETTER.publicSlug}/subscribe`;
const ACK = { status: "check_your_inbox" };
const LIST_ID = "77777777-7777-4777-8777-777777777777";

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
  m.listCreate.mockResolvedValue({ id: LIST_ID });
  m.subscriber.mockImplementation(async () => ({
    ...NEWSLETTER_SUBSCRIBER,
    status: "PENDING",
    source: "SIGNUP_FORM",
    contactId: m.createMany.mock.lastCall?.[0].data.contactId ?? null,
  }));
  m.pending.mockImplementation(
    async ({ where }: { where: { OR: { id: string }[] } }) =>
      where.OR.map(({ id }) => ({ id })),
  );
  m.updateMany.mockResolvedValue({ count: 1 });
  m.send.mockResolvedValue({ data: { id: "confirmation" }, error: null });
  m.redis.mockResolvedValue(1);
  const tx = {
    $executeRaw: vi.fn(),
    newsletter: { findUniqueOrThrow: m.newsletter, update: m.newsletterUpdate },
    contact: {
      findMany: vi.fn(async () => []),
      createMany: m.contactCreateMany,
    },
    contactChannel: {
      findMany: vi.fn(async () => []),
      createMany: m.channelCreateMany,
    },
    contactActivity: { createMany: vi.fn() },
    contactList: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: m.listCreate,
      update: vi.fn(),
    },
    contactListMember: { createMany: m.listMembers },
    newsletterSubscriber: {
      createMany: m.createMany,
      findUnique: m.subscriber,
      updateMany: m.updateMany,
      update: m.update,
    },
    newsletterEvent: { create: m.eventCreate },
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
    const person = m.contactCreateMany.mock.calls[0][0].data[0];
    expect(person).toMatchObject({
      name: "Ada",
      workspaceId: NEWSLETTER.workspaceId,
      createdByUserId: null,
      createdBySokoBotId: null,
    });
    expect(m.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: NEWSLETTER_SUBSCRIBER.id },
      data: { contactId: person.id },
    });
    expect(m.channelCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        contactId: person.id,
        type: "EMAIL",
        value: "reader@example.com",
        source: "OTHER",
      }),
    ]);
    expect(m.listMembers.mock.calls[0][0].data).toEqual([
      {
        contactId: person.id,
        listId: LIST_ID,
        addedByUserId: null,
        addedBySokoBotId: null,
      },
    ]);
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
      /href="(https:\/\/core\.example\.com\/v1\/public\/newsletter\/confirm[^\"]+)"/,
    )?.[1];
    expect(link).toBeDefined();
    const token = new globalThis.URL(link!).searchParams.get("token")!;
    expect(verifyNewsletterConfirmToken(token, "test-secret")).toEqual({
      newsletterId: NEWSLETTER_ID,
      subscriberId: NEWSLETTER_SUBSCRIBER.id,
      consentAt: NEWSLETTER_NOW.getTime(),
    });
  });

  it("retries a concurrent Contact insert before sending one confirmation", async () => {
    m.contactCreateMany.mockRejectedValueOnce({ code: "P2002" });
    await signup();
    expect(m.transaction).toHaveBeenCalledTimes(2);
    expect(m.eventCreate).toHaveBeenCalledOnce();
    expect(m.send).toHaveBeenCalledOnce();
  });

  it("does not send a confirmation after an unsubscribe wins before dispatch", async () => {
    m.pending.mockResolvedValue([]);
    await signup();
    expect(m.pending).toHaveBeenCalledWith({
      where: {
        newsletterId: NEWSLETTER_ID,
        newsletter: expect.any(Object),
        status: "PENDING",
        unsubscribedAt: null,
        bouncedAt: null,
        OR: [{ id: NEWSLETTER_SUBSCRIBER.id, consentAt: NEWSLETTER_NOW }],
      },
      select: { id: true },
    });
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

  it.each(["ACTIVE", "UNSUBSCRIBED", "BOUNCED"])(
    "does nothing for %s with the same acknowledgment",
    async (status) => {
      m.createMany.mockResolvedValue({ count: 0 });
      m.subscriber.mockResolvedValue({ ...NEWSLETTER_SUBSCRIBER, status });
      await signup();
      expect(m.updateMany).not.toHaveBeenCalled();
      expect(m.eventCreate).not.toHaveBeenCalled();
      expect(m.send).not.toHaveBeenCalled();
      expect(m.contactCreateMany).not.toHaveBeenCalled();
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

  it("preserves unsubscribe and confirmation history without sending another opt-in", async () => {
    m.createMany.mockResolvedValue({ count: 0 });
    m.subscriber.mockResolvedValue({
      ...NEWSLETTER_SUBSCRIBER,
      status: "UNSUBSCRIBED",
      unsubscribedAt: NEWSLETTER_NOW,
      confirmedAt: NEWSLETTER_NOW,
    });
    await signup();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
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
      expect(m.contactCreateMany).not.toHaveBeenCalled();
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
