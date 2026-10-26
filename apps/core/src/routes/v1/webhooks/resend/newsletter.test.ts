import { createHmac } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { NewsletterSubscriber, Prisma } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import {
  NEWSLETTER_ID,
  NEWSLETTER_ISSUE_ID,
  NEWSLETTER_NOW,
  NEWSLETTER_SUBSCRIBER,
  NEWSLETTER_SUBSCRIBER_ID,
} from "@/test/newsletter";

import router from "../index";

const m = vi.hoisted(() => {
  const state: {
    enabled: boolean;
    secret?: string;
    subscriber: NewsletterSubscriber | null;
    events: Prisma.NewsletterEventCreateManyInput[];
  } = { enabled: true, subscriber: null, events: [] };
  return {
    state,
    findSend: vi.fn(),
    createEvents: vi.fn(),
    updateSubscriber: vi.fn(),
    transaction: vi.fn(),
  };
});

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NEWSLETTER_ENABLED: m.state.enabled,
      RESEND_NEWSLETTER_WEBHOOK_SECRET: m.state.secret,
    }),
  };
});
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletterSend: { findUnique: m.findSend },
    $transaction: m.transaction,
  },
}));

const SECRET = process.env.RESEND_NEWSLETTER_WEBHOOK_SECRET!;
const URL = "http://localhost/v1/webhooks/resend/newsletter";
const SEND_ID = "66666666-6666-4666-8666-666666666666";
const EMAIL_ID = "77777777-7777-4777-8777-777777777777";
const OCCURRED_AT = "2026-10-23T09:59:00.000Z";

function payload(type = "email.delivered", data = {}) {
  return {
    type,
    created_at: OCCURRED_AT,
    data: {
      email_id: EMAIL_ID,
      from: "newsletter@news.example.com",
      to: ["reader@example.com"],
      tags: { category: "newsletter" },
      ...data,
    },
  };
}

function signedRequest(
  body = JSON.stringify(payload()),
  options: { id?: string; timestamp?: number; secret?: string } = {},
): RequestInit {
  const id = options.id ?? "msg_newsletter_event";
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac(
    "sha256",
    Buffer.from((options.secret ?? SECRET).slice("whsec_".length), "base64"),
  )
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body,
  };
}

function app() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "newsletter_webhook_test");
    await next();
  });
  app.onError(errorHandler);
  app.route("/v1/webhooks", router);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NEWSLETTER_NOW);
  m.state.enabled = true;
  m.state.secret = SECRET;
  m.state.subscriber = { ...NEWSLETTER_SUBSCRIBER };
  m.state.events = [];
  m.findSend.mockResolvedValue({
    id: SEND_ID,
    issueId: NEWSLETTER_ISSUE_ID,
    subscriberId: NEWSLETTER_SUBSCRIBER_ID,
    issue: { newsletterId: NEWSLETTER_ID },
  });
  m.createEvents.mockImplementation(
    ({ data }: { data: Prisma.NewsletterEventCreateManyInput }) => {
      if (
        m.state.events.some(
          (event) => event.providerEventId === data.providerEventId,
        )
      ) {
        return { count: 0 };
      }
      m.state.events.push(data);
      return { count: 1 };
    },
  );
  m.updateSubscriber.mockImplementation(
    ({
      where,
      data,
    }: {
      where: { id: string; status: { not: string } };
      data: {
        status: NewsletterSubscriber["status"];
        bouncedAt?: Date;
        unsubscribedAt?: Date;
      };
    }) => {
      const subscriber = m.state.subscriber;
      if (
        !subscriber ||
        subscriber.id !== where.id ||
        subscriber.status === where.status.not
      ) {
        return { count: 0 };
      }
      Object.assign(subscriber, data);
      return { count: 1 };
    },
  );
  const tx = {
    newsletterEvent: { createMany: m.createEvents },
    newsletterSubscriber: { updateMany: m.updateSubscriber },
  };
  m.transaction.mockImplementation(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /v1/webhooks/resend/newsletter", () => {
  it("verifies the original raw body without session auth", async () => {
    const body = JSON.stringify(
      payload("email.delivered", { subject: "News — hello" }),
      null,
      2,
    );
    const request = signedRequest(body);
    const headers = new Headers(request.headers);
    headers.delete("Content-Type");
    const response = await app().request(URL, { ...request, headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { received: true } });
    expect(m.findSend).toHaveBeenCalledWith(
      expect.objectContaining({ where: { providerMessageId: EMAIL_ID } }),
    );
    expect(m.state.events).toHaveLength(1);
  });

  it("accepts any matching v1 signature during signing key rotation", async () => {
    const request = signedRequest();
    const headers = new Headers(request.headers);
    headers.set(
      "svix-signature",
      `v1,invalid v2,ignored ${headers.get("svix-signature")}`,
    );
    expect((await app().request(URL, { ...request, headers })).status).toBe(
      200,
    );
    expect(m.state.events).toHaveLength(1);
  });

  it("rejects a signature made with another secret", async () => {
    const request = signedRequest(undefined, {
      secret: "whsec_d3Jvbmctc2VjcmV0",
    });
    expect((await app().request(URL, request)).status).toBe(401);
    expect(m.findSend).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("rejects a body changed after signing", async () => {
    const response = await app().request(URL, {
      ...signedRequest(),
      body: JSON.stringify(payload("email.complained")),
    });
    expect(response.status).toBe(401);
    expect(m.findSend).not.toHaveBeenCalled();
  });

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "rejects a missing %s header",
    async (name) => {
      const request = signedRequest();
      const headers = new Headers(request.headers);
      headers.delete(name);
      expect((await app().request(URL, { ...request, headers })).status).toBe(
        401,
      );
      expect(m.findSend).not.toHaveBeenCalled();
    },
  );

  it.each([-301, 301])(
    "rejects a timestamp offset by %s seconds",
    async (offset) => {
      const request = signedRequest(undefined, {
        timestamp: Math.floor(Date.now() / 1000) + offset,
      });
      expect((await app().request(URL, request)).status).toBe(401);
      expect(m.findSend).not.toHaveBeenCalled();
    },
  );

  it("returns 503 without processing when the secret is missing", async () => {
    m.state.secret = undefined;
    expect((await app().request(URL, signedRequest())).status).toBe(503);
    expect(m.findSend).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 before checking the secret, headers or body when disabled", async () => {
    m.state.enabled = false;
    m.state.secret = undefined;
    const response = await app().request(URL, {
      method: "POST",
      body: "not-json",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      message: "Newsletter is not enabled",
    });
    expect(m.findSend).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["email.delivered", "DELIVERED"],
    ["email.opened", "OPENED"],
    ["email.clicked", "CLICKED"],
    ["email.bounced", "BOUNCED"],
    ["email.complained", "COMPLAINED"],
  ])(
    "maps %s to %s with all relations and the provider occurrence time",
    async (event, type) => {
      const link = "https://example.com/article?source=newsletter";
      const response = await app().request(
        URL,
        signedRequest(JSON.stringify(payload(event, { click: { link } }))),
      );
      expect(response.status).toBe(200);
      expect(m.createEvents).toHaveBeenCalledExactlyOnceWith({
        data: {
          newsletterId: NEWSLETTER_ID,
          issueId: NEWSLETTER_ISSUE_ID,
          subscriberId: NEWSLETTER_SUBSCRIBER_ID,
          sendId: SEND_ID,
          type,
          url: type === "CLICKED" ? link : undefined,
          occurredAt: new Date(OCCURRED_AT),
          providerEventId: "msg_newsletter_event",
        },
        skipDuplicates: true,
      });
      if (["DELIVERED", "OPENED", "CLICKED"].includes(type)) {
        expect(m.updateSubscriber).not.toHaveBeenCalled();
        expect(m.state.subscriber).toEqual(NEWSLETTER_SUBSCRIBER);
      }
    },
  );

  it.each([undefined, "Permanent", "Hard", " permanent "])(
    "suppresses permanent bounces with type %s",
    async (type) => {
      const response = await app().request(
        URL,
        signedRequest(
          JSON.stringify(payload("email.bounced", { bounce: { type } })),
        ),
      );
      expect(response.status).toBe(200);
      expect(m.state.subscriber).toMatchObject({
        status: "BOUNCED",
        bouncedAt: new Date(OCCURRED_AT),
        unsubscribedAt: null,
      });
    },
  );

  it.each(["Transient", "Soft", "Undetermined"])(
    "records a %s bounce without suppressing the subscriber",
    async (type) => {
      const response = await app().request(
        URL,
        signedRequest(
          JSON.stringify(payload("email.bounced", { bounce: { type } })),
        ),
      );
      expect(response.status).toBe(200);
      expect(m.state.events[0]?.type).toBe("BOUNCED");
      expect(m.updateSubscriber).not.toHaveBeenCalled();
      expect(m.state.subscriber).toEqual(NEWSLETTER_SUBSCRIBER);
    },
  );

  it.each(["ACTIVE", "BOUNCED"] as const)(
    "unsubscribes a %s subscriber on complaint",
    async (status) => {
      m.state.subscriber = { ...NEWSLETTER_SUBSCRIBER, status };
      const response = await app().request(
        URL,
        signedRequest(JSON.stringify(payload("email.complained"))),
      );
      expect(response.status).toBe(200);
      expect(m.state.subscriber).toMatchObject({
        status: "UNSUBSCRIBED",
        unsubscribedAt: new Date(OCCURRED_AT),
      });
    },
  );

  it.each([
    "email.bounced",
    "email.complained",
    "email.delivered",
    "email.opened",
    "email.clicked",
  ])("preserves an existing unsubscribe on %s", async (type) => {
    const subscriber = {
      ...NEWSLETTER_SUBSCRIBER,
      status: "UNSUBSCRIBED" as const,
      unsubscribedAt: new Date("2026-10-22T12:00:00Z"),
    };
    m.state.subscriber = { ...subscriber };
    const response = await app().request(
      URL,
      signedRequest(
        JSON.stringify(
          payload(type, { click: { link: "https://example.com" } }),
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(m.state.subscriber).toEqual(subscriber);
    expect(m.state.events).toHaveLength(1);
  });

  it("records a duplicate delivery once by svix-id", async () => {
    const server = app();
    for (let i = 0; i < 2; i++) {
      expect((await server.request(URL, signedRequest())).status).toBe(200);
    }
    expect(m.state.events).toHaveLength(1);
    expect(m.updateSubscriber).not.toHaveBeenCalled();
  });

  it("does not repeat complaint side effects for a duplicate svix-id", async () => {
    const server = app();
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await server.request(
            URL,
            signedRequest(JSON.stringify(payload("email.complained"))),
          )
        ).status,
      ).toBe(200);
    }
    expect(m.state.events).toHaveLength(1);
    expect(m.updateSubscriber).toHaveBeenCalledOnce();
  });

  it("keeps distinct provider events for the same email", async () => {
    const server = app();
    for (const id of ["msg_open_1", "msg_open_2"]) {
      expect(
        (
          await server.request(
            URL,
            signedRequest(JSON.stringify(payload("email.opened")), { id }),
          )
        ).status,
      ).toBe(200);
    }
    expect(m.state.events).toHaveLength(2);
  });

  it.each([
    ["email.delivered", "ACTIVE"],
    ["email.opened", "ACTIVE"],
    ["email.clicked", "ACTIVE"],
    ["email.bounced", "BOUNCED"],
    ["email.complained", "UNSUBSCRIBED"],
  ])(
    "retries an early %s event until its send is saved",
    async (type, status) => {
      m.findSend.mockResolvedValueOnce(null);
      const server = app();
      const body = JSON.stringify(
        payload(type, {
          click: { link: "https://example.com/article" },
          bounce: { type: "Permanent" },
        }),
      );

      expect((await server.request(URL, signedRequest(body))).status).toBe(503);
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.state.events).toHaveLength(0);
      expect(m.state.subscriber).toEqual(NEWSLETTER_SUBSCRIBER);

      for (let i = 0; i < 2; i++) {
        expect((await server.request(URL, signedRequest(body))).status).toBe(
          200,
        );
      }
      expect(m.state.events).toHaveLength(1);
      expect(m.state.subscriber?.status).toBe(status);
      if (status !== "ACTIVE") {
        expect(m.updateSubscriber).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([undefined, {}, { category: "reset-password" }])(
    "acknowledges unknown unrelated emails with tags %j",
    async (tags) => {
      m.findSend.mockResolvedValue(null);
      const request = signedRequest(
        JSON.stringify(payload("email.delivered", { tags })),
      );
      expect((await app().request(URL, request)).status).toBe(200);
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.createEvents).not.toHaveBeenCalled();
      expect(m.updateSubscriber).not.toHaveBeenCalled();
    },
  );

  it("acknowledges unrelated event types", async () => {
    const request = signedRequest(
      JSON.stringify({ type: "contact.updated", data: {} }),
    );
    expect((await app().request(URL, request)).status).toBe(200);
    expect(m.findSend).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload(), created_at: "invalid-date" },
    payload("email.delivered", { email_id: "" }),
    payload("email.clicked"),
    payload("email.clicked", { click: { link: "" } }),
  ])("rejects a malformed supported event: %j", async (event) => {
    expect(
      (await app().request(URL, signedRequest(JSON.stringify(event)))).status,
    ).toBe(422);
    expect(m.findSend).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("returns 500 on database failure so the provider can retry", async () => {
    m.createEvents.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await app().request(URL, signedRequest())).status).toBe(500);
    expect(m.updateSubscriber).not.toHaveBeenCalled();
  });

  it("documents the mounted endpoint without session authentication", () => {
    const document = app().getOpenAPIDocument({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
    });
    expect(
      document.paths?.["/v1/webhooks/resend/newsletter"]?.post,
    ).toMatchObject({
      security: [],
      responses: {
        "200": expect.any(Object),
        "401": expect.any(Object),
        "404": expect.any(Object),
        "503": expect.any(Object),
      },
    });
  });
});
