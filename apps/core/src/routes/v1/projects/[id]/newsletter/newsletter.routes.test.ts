import { OpenAPIHono } from "@hono/zod-openapi";
import type {
  Newsletter,
  NewsletterSubscriber,
  Prisma,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import { verifyNewsletterConfirmToken } from "@/lib/newsletter/confirm-token";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import { confirmNewsletterSubscriber } from "@/services/newsletter-signup.service";
import { newsletterWorkspace } from "@/test/newsletter";

import mountGet from "./get";
import mountPut from "./put";
import mountDelete from "./subscribers/[subscriberId]/delete";
import mountPatch from "./subscribers/[subscriberId]/patch";
import mountFromContacts from "./subscribers/from-contacts/post";
import mountList from "./subscribers/get";
import mountImport from "./subscribers/import/post";
import mountAdd from "./subscribers/post";

const m = vi.hoisted(() => ({
  workspaceFindUnique: vi.fn(),
  projectFindFirst: vi.fn(),
  newsletterFindUnique: vi.fn(),
  newsletterUpsert: vi.fn(),
  findMany: vi.fn(),
  pendingFindMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  newsletterUpdate: vi.fn(),
  contactFindMany: vi.fn(),
  contactCreateMany: vi.fn(),
  channelFindMany: vi.fn(),
  channelCreateMany: vi.fn(),
  activityCreateMany: vi.fn(),
  listFindFirst: vi.fn(),
  listFindMany: vi.fn(),
  listFindUnique: vi.fn(),
  listCreate: vi.fn(),
  listUpdate: vi.fn(),
  memberCreateMany: vi.fn(),
  sendEmail: vi.fn(),
  redis: vi.fn(),
  createManyAndReturn: vi.fn(),
  createEvents: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("@/clients/email.client", () => ({ sendEmail: m.sendEmail }));
vi.mock("@/lib/redis", () => ({ getRedisClient: () => ({ eval: m.redis }) }));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    workspace: { findUnique: m.workspaceFindUnique },
    member: { findUnique: vi.fn(async () => ({ userId: "user_1" })) },
    project: { findFirst: m.projectFindFirst },
    newsletter: {
      findUnique: m.newsletterFindUnique,
      upsert: m.newsletterUpsert,
      findUniqueOrThrow: m.newsletterFindUnique,
      update: m.newsletterUpdate,
    },
    $transaction: m.transaction,
    $executeRaw: m.executeRaw,
    contact: { findMany: m.contactFindMany, createMany: m.contactCreateMany },
    contactChannel: {
      findMany: m.channelFindMany,
      createMany: m.channelCreateMany,
    },
    contactActivity: { createMany: m.activityCreateMany },
    contactList: {
      findFirst: m.listFindFirst,
      findMany: m.listFindMany,
      findUnique: m.listFindUnique,
      create: m.listCreate,
      update: m.listUpdate,
    },
    contactListMember: { createMany: m.memberCreateMany },
    newsletterSubscriber: {
      // The pre-send re-check of pending confirmations has its own mock.
      findMany: (args: Prisma.NewsletterSubscriberFindManyArgs) =>
        args.where?.status === "PENDING" && args.where.OR
          ? m.pendingFindMany(args)
          : m.findMany(args),
      count: m.count,
      groupBy: m.groupBy,
      findUnique: m.findUnique,
      update: m.update,
      updateMany: m.updateMany,
      deleteMany: m.deleteMany,
      createManyAndReturn: m.createManyAndReturn,
    },
    newsletterEvent: { createMany: m.createEvents, create: m.eventCreate },
  };
  return {
    default: client,
  };
});

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const NEWSLETTER_ID = "33333333-3333-4333-8333-333333333333";
const SUBSCRIBER_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_SUBSCRIBER_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-10-23T10:00:00Z");
const CONTACT_ID = "66666666-6666-4666-8666-666666666666";
const LIST_ID = "77777777-7777-4777-8777-777777777777";
const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: "organization_1",
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: "user_1",
  organizationId: "organization_1",
};
const SETTINGS = {
  name: "Weekly News",
  senderName: "Ada",
  replyTo: "ada@example.com",
  brand: { primaryColor: "#123456", footerText: "Thanks for reading" },
  welcomeEmailEnabled: false,
};
const NEWSLETTER: Newsletter = {
  id: NEWSLETTER_ID,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  contactListId: null,
  ...SETTINGS,
  publicSlug: "weekly-news-1234abcd",
  welcomeSubject: null,
  welcomeBody: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const SUBSCRIBER: NewsletterSubscriber = {
  id: SUBSCRIBER_ID,
  newsletterId: NEWSLETTER_ID,
  contactId: null,
  email: "ada@example.com",
  name: "Ada",
  status: "ACTIVE",
  source: "MANUAL",
  consentAt: NOW,
  confirmedAt: null,
  welcomeSentAt: null,
  welcomeLeaseExpiresAt: null,
  unsubscribedAt: null,
  bouncedAt: null,
  createdAt: NOW,
};
const BASE = `http://localhost/${PROJECT_ID}/newsletter`;
const SCOPE = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };

function json(method: "POST" | "PUT" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** linkNewsletterContacts may also restore list members through raw SQL. */
function relinkQuery(): { sql: string; values: unknown[] } | undefined {
  return m.executeRaw.mock.calls
    .map(([query]) => query)
    .find((query) => query.sql.includes('UPDATE "newsletter_subscriber"'));
}

function createApp(
  authContext: AuthenticationContext | null = AUTH,
  workspaceContext: WorkspaceContext | null = WORKSPACE,
) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    if (!authContext) throw unauthorized("Unauthorized");
    c.set("requestId", "newsletter_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    await next();
  });
  mountGet(app);
  mountPut(app);
  mountList(app);
  mountAdd(app);
  mountImport(app);
  mountFromContacts(app);
  mountPatch(app);
  mountDelete(app);
  app.onError(errorHandler);
  return app;
}

function allOperations(app = createApp()) {
  return [
    app.request(BASE),
    app.request(BASE, json("PUT", SETTINGS)),
    app.request(`${BASE}/subscribers`),
    app.request(
      `${BASE}/subscribers`,
      json("POST", { email: "ada@example.com", consent: "CONFIRMED" }),
    ),
    app.request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "email\na@example.com", consent: "CONFIRMED" }),
    ),
    app.request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { name: "New name" }),
    ),
    app.request(`${BASE}/subscribers/${SUBSCRIBER_ID}`, { method: "DELETE" }),
    app.request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", { contactIds: [CONTACT_ID], consent: "CONFIRMED" }),
    ),
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  m.redis.mockResolvedValue(1);
  m.workspaceFindUnique.mockResolvedValue(newsletterWorkspace());
  m.projectFindFirst.mockResolvedValue({
    id: PROJECT_ID,
    closingAt: null,
    closedAt: null,
  });
  m.newsletterFindUnique.mockResolvedValue(NEWSLETTER);
  m.newsletterUpsert.mockResolvedValue(NEWSLETTER);
  m.transaction.mockImplementation(
    (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(prisma),
  );
  m.newsletterUpdate.mockResolvedValue(NEWSLETTER);
  m.contactFindMany.mockResolvedValue([]);
  m.channelFindMany.mockResolvedValue([]);
  m.listFindFirst.mockResolvedValue(null);
  m.listFindMany.mockResolvedValue([]);
  m.listFindUnique.mockResolvedValue(null);
  m.listCreate.mockResolvedValue({ id: LIST_ID });
  m.findMany.mockResolvedValue([SUBSCRIBER]);
  m.pendingFindMany.mockImplementation(
    async ({ where }: { where: { OR: { id: string }[] } }) =>
      where.OR.map(({ id }) => ({ id })),
  );
  m.count.mockResolvedValue(1);
  m.groupBy.mockResolvedValue([{ status: "ACTIVE", _count: { _all: 1 } }]);
  m.findUnique.mockResolvedValue(SUBSCRIBER);
  m.update.mockResolvedValue(SUBSCRIBER);
  m.deleteMany.mockResolvedValue({ count: 1 });
  m.createManyAndReturn.mockImplementation(
    ({ data }: { data: Prisma.NewsletterSubscriberCreateManyInput[] }) =>
      data.map((row, index) => ({
        ...SUBSCRIBER,
        ...row,
        name: row.name ?? null,
        id:
          index === 0
            ? SUBSCRIBER_ID
            : `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })),
  );
});

describe("Project newsletter access", () => {
  it("requires authentication and a workspace on every route", async () => {
    const unauthorizedResponses = await Promise.all(
      allOperations(createApp(null)),
    );
    expect(unauthorizedResponses.map((response) => response.status)).toEqual(
      Array(8).fill(401),
    );
    const forbiddenResponses = await Promise.all(
      allOperations(createApp(AUTH, null)),
    );
    expect(forbiddenResponses.map((response) => response.status)).toEqual(
      Array(8).fill(403),
    );
    expect(m.projectFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    { organization: { slug: "other-workspace" } },
    { organization: null },
    null,
  ])("hides every route outside the beta workspace: %j", async (workspace) => {
    m.workspaceFindUnique.mockResolvedValue(workspace);
    const responses = await Promise.all(allOperations());
    expect(responses.map((response) => response.status)).toEqual(
      Array(8).fill(404),
    );
    expect(m.workspaceFindUnique).toHaveBeenCalledWith({
      where: { id: WORKSPACE_ID },
      select: { organization: { select: { slug: true } } },
    });
    expect(m.projectFindFirst).not.toHaveBeenCalled();
    expect(m.newsletterFindUnique).not.toHaveBeenCalled();
    expect(m.newsletterUpsert).not.toHaveBeenCalled();
    expect(m.createManyAndReturn).not.toHaveBeenCalled();
    expect(m.createEvents).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a coworker without user context on every route", async () => {
    const responses = await Promise.all(
      allOperations(
        createApp({
          actor: "coworker",
          coworkerId: "cow_1",
          vendorId: "vendor_1",
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array(8).fill(403),
    );
    expect(m.projectFindFirst).not.toHaveBeenCalled();
  });

  it("requires the project in the active workspace on every route", async () => {
    m.projectFindFirst.mockResolvedValue(null);
    const responses = await Promise.all(allOperations());
    expect(responses.map((response) => response.status)).toEqual(
      Array(8).fill(404),
    );
    expect(m.projectFindFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: {
        id: true,
        closingAt: true,
        closedAt: true,
        workspace: { select: { organization: { select: { slug: true } } } },
      },
    });
    expect(m.newsletterFindUnique).not.toHaveBeenCalled();
    expect(m.newsletterUpsert).not.toHaveBeenCalled();
  });

  it("returns 404 for absent newsletter settings", async () => {
    m.newsletterFindUnique.mockResolvedValue(null);
    const responses = await Promise.all(allOperations());
    expect(responses.map((response) => response.status)).toEqual([
      404, 200, 404, 404, 404, 404, 404, 404,
    ]);
    expect(m.createManyAndReturn).not.toHaveBeenCalled();
  });
});

describe("newsletter settings", () => {
  it("returns settings with ISO dates", async () => {
    const response = await createApp().request(BASE);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        id: NEWSLETTER_ID,
        brand: SETTINGS.brand,
        createdAt: NOW.toISOString(),
      },
    });
    expect(m.newsletterFindUnique).toHaveBeenCalledWith({ where: SCOPE });
  });

  it("creates settings with a generated slug and normalized reply-to", async () => {
    const response = await createApp().request(
      BASE,
      json("PUT", { ...SETTINGS, replyTo: " ADA@Example.com " }),
    );
    expect(response.status).toBe(200);
    expect(m.newsletterUpsert).toHaveBeenCalledWith({
      where: SCOPE,
      create: {
        ...SCOPE,
        ...SETTINGS,
        welcomeSubject: null,
        welcomeBody: null,
        publicSlug: expect.stringMatching(/^weekly-news-[a-f0-9]{8}$/),
      },
      update: { ...SETTINGS, welcomeSubject: null, welcomeBody: null },
    });
  });

  it("updates settings and welcome content without changing the public slug", async () => {
    const input = {
      ...SETTINGS,
      name: "Renamed",
      welcomeEmailEnabled: true,
      welcomeSubject: "Welcome",
      welcomeBody: "Hello",
    };
    m.newsletterUpsert.mockResolvedValue({ ...NEWSLETTER, ...input });
    const response = await createApp().request(BASE, json("PUT", input));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { ...input, publicSlug: NEWSLETTER.publicSlug },
    });
    expect(m.newsletterUpsert.mock.calls[0][0].update).toEqual(input);
  });

  it("retries a generated slug collision", async () => {
    m.newsletterUpsert.mockRejectedValueOnce({
      code: "P2002",
      meta: { target: ["publicSlug"] },
    });
    const response = await createApp().request(BASE, json("PUT", SETTINGS));
    expect(response.status).toBe(200);
    expect(m.newsletterUpsert).toHaveBeenCalledTimes(2);
    expect(m.newsletterUpsert.mock.calls[0][0].create.publicSlug).not.toBe(
      m.newsletterUpsert.mock.calls[1][0].create.publicSlug,
    );
  });

  it.each([
    { replyTo: "bad" },
    { name: " " },
    { brand: { logoUrl: "javascript:alert(1)" } },
    { brand: { primaryColor: "bad" } },
  ])("validates settings: %j", async (change) => {
    const response = await createApp().request(
      BASE,
      json("PUT", { ...SETTINGS, ...change }),
    );
    expect(response.status).toBe(422);
    expect(m.newsletterUpsert).not.toHaveBeenCalled();
  });
});

describe("newsletter subscribers", () => {
  it("asks for manual consent with the signup confirmation token and email", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ada@example.com", consent: "ASK" }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { status: "PENDING", source: "MANUAL" },
    });
    expect(m.sendEmail).toHaveBeenCalledOnce();
    const mail = m.sendEmail.mock.calls[0][0];
    expect(mail).toMatchObject({
      to: "ada@example.com",
      tag: "newsletter-confirmation",
    });
    const token = mail.html.match(/confirm\?token=([^"\s]+)/)?.[1];
    expect(verifyNewsletterConfirmToken(token, "test-secret")).toEqual({
      newsletterId: NEWSLETTER_ID,
      subscriberId: SUBSCRIBER_ID,
      consentAt:
        m.createManyAndReturn.mock.calls[0][0].data[0].consentAt.getTime(),
    });
    expect(m.createEvents).toHaveBeenCalledWith({
      data: [
        {
          newsletterId: NEWSLETTER_ID,
          subscriberId: SUBSCRIBER_ID,
          type: "SUBSCRIBED",
          occurredAt: expect.any(Date),
        },
      ],
    });
    m.findUnique.mockResolvedValue({
      ...SUBSCRIBER,
      ...m.createManyAndReturn.mock.calls[0][0].data[0],
      newsletter: NEWSLETTER,
    });
    m.updateMany.mockResolvedValue({ count: 1 });
    await confirmNewsletterSubscriber(token, "en");
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
        data: { status: "ACTIVE", confirmedAt: expect.any(Date) },
      }),
    );
  });

  it.each(["UNSUBSCRIBED", "BOUNCED"])(
    "leaves an existing %s manual subscriber untouched",
    async (status) => {
      m.createManyAndReturn.mockResolvedValue([]);
      m.findMany.mockResolvedValue([{ ...SUBSCRIBER, status }]);
      const response = await createApp().request(
        `${BASE}/subscribers`,
        json("POST", { email: SUBSCRIBER.email, consent: "ASK" }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        message:
          status === "UNSUBSCRIBED"
            ? "This person unsubscribed; they cannot be subscribed again"
            : "This person's email bounced; they cannot be subscribed again",
      });
      expect(m.update).not.toHaveBeenCalled();
      expect(m.sendEmail).not.toHaveBeenCalled();
      expect(relinkQuery()?.sql).toContain('subscriber."contactId" IS NULL');
      expect(relinkQuery()?.sql).toContain(
        "subscriber.status IN ('ACTIVE', 'PENDING')",
      );
    },
  );

  it("adds an active manual subscriber with normalized email and consent time", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", {
        email: " ADA@Example.com ",
        name: " Ada ",
        consent: "CONFIRMED",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { email: "ada@example.com", status: "ACTIVE", source: "MANUAL" },
    });
    expect(m.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          newsletterId: NEWSLETTER_ID,
          contactId: expect.any(String),
          email: "ada@example.com",
          name: "Ada",
          status: "ACTIVE",
          source: "MANUAL",
          consentAt: expect.any(Date),
        },
      ],
      skipDuplicates: true,
    });
    expect(m.createEvents).toHaveBeenCalledWith({
      data: [
        {
          newsletterId: NEWSLETTER_ID,
          subscriberId: SUBSCRIBER_ID,
          type: "CONFIRMED",
          occurredAt: expect.any(Date),
        },
      ],
    });
    const person = m.contactCreateMany.mock.calls[0][0].data[0];
    expect(person).toMatchObject({
      name: "Ada",
      workspaceId: WORKSPACE_ID,
      createdByUserId: AUTH.userId,
    });
    expect(m.channelCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        contactId: person.id,
        type: "EMAIL",
        value: "ada@example.com",
        source: "MANUAL",
      }),
    ]);
    expect(m.listCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Weekly News subscribers" }),
      }),
    );
    expect(m.newsletterUpdate).toHaveBeenCalledWith({
      where: { id: NEWSLETTER_ID },
      data: { contactListId: LIST_ID },
    });
    expect(m.memberCreateMany).toHaveBeenCalledWith({
      data: [
        {
          listId: LIST_ID,
          contactId: person.id,
          addedByUserId: AUTH.userId,
          addedBySokoBotId: null,
        },
      ],
      skipDuplicates: true,
    });
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("links the contact that owns the email and preserves their name", async () => {
    m.channelFindMany.mockResolvedValue([
      { value: "ada@example.com", contactId: CONTACT_ID },
    ]);
    m.contactFindMany.mockResolvedValue([
      { id: CONTACT_ID, name: "Ada Lovelace", mergedIntoId: null },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", {
        email: "ada@example.com",
        name: "Different name",
        consent: "CONFIRMED",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { contact: { id: CONTACT_ID, name: "Ada Lovelace" } },
    });
    expect(m.createManyAndReturn.mock.calls[0][0].data[0].contactId).toBe(
      CONTACT_ID,
    );
    expect(m.contactCreateMany).not.toHaveBeenCalled();
    expect(m.channelCreateMany).not.toHaveBeenCalled();
  });

  it("links a merged email owner to the surviving contact", async () => {
    m.channelFindMany.mockResolvedValue([
      { value: "ada@example.com", contactId: SUBSCRIBER_ID },
    ]);
    m.contactFindMany
      .mockResolvedValueOnce([
        { id: SUBSCRIBER_ID, name: "Old Ada", mergedIntoId: CONTACT_ID },
      ])
      .mockResolvedValueOnce([
        { id: CONTACT_ID, name: "Ada Lovelace", mergedIntoId: null },
      ]);
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ada@example.com", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { contact: { id: CONTACT_ID, name: "Ada Lovelace" } },
    });
    expect(m.memberCreateMany.mock.calls[0][0].data[0].contactId).toBe(
      CONTACT_ID,
    );
    expect(m.contactCreateMany).not.toHaveBeenCalled();
  });

  it("reuses the stored manual list on later additions", async () => {
    m.newsletterFindUnique.mockResolvedValue({
      ...NEWSLETTER,
      contactListId: LIST_ID,
    });
    m.listFindFirst.mockResolvedValue({ id: LIST_ID });
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ada@example.com", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(201);
    expect(m.memberCreateMany.mock.calls[0][0].data[0].listId).toBe(LIST_ID);
    expect(m.listCreate).not.toHaveBeenCalled();
    expect(m.newsletterUpdate).not.toHaveBeenCalled();
  });

  it("uses a unique manual-list name when a smart list takes the default", async () => {
    m.listFindMany.mockResolvedValue([
      { nameKey: "weekly news subscribers", smartFilter: { stages: ["LEAD"] } },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ada@example.com", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(201);
    expect(m.listCreate.mock.calls[0][0].data.name).toBe(
      "Weekly News subscribers (2)",
    );
  });

  it("recreates a deleted subscriber list and stores its new id", async () => {
    m.newsletterFindUnique.mockResolvedValue({
      ...NEWSLETTER,
      contactListId: SECOND_SUBSCRIBER_ID,
    });
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ada@example.com", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(201);
    expect(m.newsletterUpdate.mock.calls[0][0].data.contactListId).toBe(
      LIST_ID,
    );
    expect(m.memberCreateMany.mock.calls[0][0].data[0].listId).toBe(LIST_ID);
  });

  it.each([undefined, false])(
    "requires explicit consent: %s",
    async (consent) => {
      const response = await createApp().request(
        `${BASE}/subscribers`,
        json("POST", { email: "ada@example.com", consent }),
      );
      expect(response.status).toBe(422);
      expect(m.createManyAndReturn).not.toHaveBeenCalled();
    },
  );

  it("returns 409 for a duplicate without updating it", async () => {
    m.createManyAndReturn.mockResolvedValue([]);
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ADA@example.com", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("filters and paginates subscribers with newsletter-wide status counts", async () => {
    m.findMany.mockResolvedValue([
      SUBSCRIBER,
      { ...SUBSCRIBER, id: SECOND_SUBSCRIBER_ID },
    ]);
    m.count.mockResolvedValue(5);
    m.groupBy.mockResolvedValue([
      { status: "ACTIVE", _count: { _all: 7 } },
      { status: "UNSUBSCRIBED", _count: { _all: 3 } },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers?status=ACTIVE&search=ADA&limit=1&cursor=${SECOND_SUBSCRIBER_ID}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        subscribers: [{ id: SUBSCRIBER_ID }],
        counts: { ACTIVE: 7, UNSUBSCRIBED: 3, PENDING: 0, BOUNCED: 0 },
      },
      meta: {
        pagination: {
          cursor: SECOND_SUBSCRIBER_ID,
          nextCursor: SUBSCRIBER_ID,
          total: 5,
          limit: 1,
        },
      },
    });
    expect(m.findMany).toHaveBeenCalledWith({
      where: {
        newsletterId: NEWSLETTER_ID,
        status: "ACTIVE",
        OR: [
          { email: { contains: "ADA", mode: "insensitive" } },
          { contact: { name: { contains: "ADA", mode: "insensitive" } } },
          {
            contact: {
              mergedInto: { name: { contains: "ADA", mode: "insensitive" } },
            },
          },
        ],
      },
      cursor: { id: SECOND_SUBSCRIBER_ID },
      skip: 1,
      take: 2,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(m.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { newsletterId: NEWSLETTER_ID },
      _count: { _all: true },
    });
  });

  it("returns null for a legacy subscriber without a contact", async () => {
    const response = await createApp().request(`${BASE}/subscribers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { subscribers: [{ contact: null }] },
    });
    expect(m.contactFindMany).not.toHaveBeenCalled();
  });

  it("returns the surviving contact after a merge, including further merges", async () => {
    m.findMany.mockResolvedValue([{ ...SUBSCRIBER, contactId: SUBSCRIBER_ID }]);
    m.contactFindMany
      .mockResolvedValueOnce([
        {
          id: SUBSCRIBER_ID,
          name: "Old name",
          mergedIntoId: SECOND_SUBSCRIBER_ID,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: SECOND_SUBSCRIBER_ID,
          name: "Another old name",
          mergedIntoId: CONTACT_ID,
        },
      ])
      .mockResolvedValueOnce([
        { id: CONTACT_ID, name: "Surviving person", mergedIntoId: null },
      ]);
    const response = await createApp().request(`${BASE}/subscribers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        subscribers: [
          { contact: { id: CONTACT_ID, name: "Surviving person" } },
        ],
      },
    });
  });

  it("returns an empty page with no next cursor", async () => {
    m.findMany.mockResolvedValue([]);
    m.count.mockResolvedValue(0);
    m.groupBy.mockResolvedValue([]);
    const response = await createApp().request(`${BASE}/subscribers`);
    expect(await response.json()).toMatchObject({
      data: {
        subscribers: [],
        counts: { PENDING: 0, ACTIVE: 0, UNSUBSCRIBED: 0, BOUNCED: 0 },
      },
      meta: { pagination: { nextCursor: null, total: 0 } },
    });
  });

  it("changes a name and unsubscribes with a timestamp", async () => {
    m.update.mockResolvedValue({
      ...SUBSCRIBER,
      name: null,
      status: "UNSUBSCRIBED",
      unsubscribedAt: NOW,
    });
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { name: null, status: "UNSUBSCRIBED" }),
    );
    expect(response.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({
      where: {
        id: SUBSCRIBER_ID,
        newsletterId: NEWSLETTER_ID,
        status: "ACTIVE",
      },
      data: {
        name: null,
        status: "UNSUBSCRIBED",
        unsubscribedAt: expect.any(Date),
        events: {
          create: {
            newsletterId: NEWSLETTER_ID,
            type: "UNSUBSCRIBED",
            occurredAt: expect.any(Date),
          },
        },
      },
    });
  });

  it.each([
    ["UNSUBSCRIBED", "ACTIVE"],
    ["BOUNCED", "ACTIVE"],
    ["UNSUBSCRIBED", "UNSUBSCRIBED"],
    ["BOUNCED", "UNSUBSCRIBED"],
  ] as const)(
    "cannot overwrite a concurrent %s status with an %s patch",
    async (status, requestedStatus) => {
      let current: NewsletterSubscriber = { ...SUBSCRIBER };
      m.findUnique.mockImplementation(() => {
        const before = { ...current };
        current = {
          ...current,
          status,
          ...(status === "UNSUBSCRIBED"
            ? { unsubscribedAt: NOW }
            : { bouncedAt: NOW }),
        };
        return before;
      });
      m.update.mockImplementation(
        ({ where, data }: Prisma.NewsletterSubscriberUpdateArgs) => {
          if (where.status && where.status !== current.status)
            throw { code: "P2025" };
          if (data.status === "ACTIVE" || data.status === "UNSUBSCRIBED")
            current.status = data.status;
          if (typeof data.name === "string") current.name = data.name;
          return current;
        },
      );
      const response = await createApp().request(
        `${BASE}/subscribers/${SUBSCRIBER_ID}`,
        json("PATCH", { name: "New name", status: requestedStatus }),
      );
      expect(response.status).toBe(409);
      expect(current.status).toBe(status);
      expect(current.name).toBe(SUBSCRIBER.name);
      expect(
        status === "UNSUBSCRIBED" ? current.unsubscribedAt : current.bouncedAt,
      ).toEqual(NOW);
    },
  );

  it("keeps an unsubscribe when only the name changes concurrently", async () => {
    let current = { ...SUBSCRIBER };
    m.findUnique.mockImplementation(() => {
      const before = { ...current };
      current = { ...current, status: "UNSUBSCRIBED", unsubscribedAt: NOW };
      return before;
    });
    m.update.mockImplementation(
      ({ data }: Prisma.NewsletterSubscriberUpdateArgs) => {
        if (typeof data.name === "string") current.name = data.name;
        return current;
      },
    );
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { name: "New name" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        name: "New name",
        status: "UNSUBSCRIBED",
        unsubscribedAt: NOW.toISOString(),
      },
    });
  });

  it.each(["PENDING", "UNSUBSCRIBED", "BOUNCED"])(
    "cannot manually reactivate %s",
    async (status) => {
      m.findUnique.mockResolvedValue({ ...SUBSCRIBER, status });
      const response = await createApp().request(
        `${BASE}/subscribers/${SUBSCRIBER_ID}`,
        json("PATCH", { status: "ACTIVE" }),
      );
      expect(response.status).toBe(409);
      expect(m.update).not.toHaveBeenCalled();
    },
  );

  it.each(["PENDING", "BOUNCED"])("cannot manually set %s", async (status) => {
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { status }),
    );
    expect(response.status).toBe(422);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("allows renaming a bounced subscriber without changing status", async () => {
    m.findUnique.mockResolvedValue({ ...SUBSCRIBER, status: "BOUNCED" });
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { name: "New name" }),
    );
    expect(response.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "New name" },
      }),
    );
  });

  it("preserves the timestamp on an unchanged subscription status", async () => {
    m.findUnique.mockResolvedValue({
      ...SUBSCRIBER,
      status: "UNSUBSCRIBED",
      unsubscribedAt: NOW,
    });
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { status: "UNSUBSCRIBED" }),
    );
    expect(response.status).toBe(200);
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("unsubscribedAt");
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("events");
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("status");
  });

  it.each(["UNSUBSCRIBED", "BOUNCED"])(
    "does not overwrite a concurrent %s during a status change",
    async (status) => {
      const current = { ...SUBSCRIBER, status };
      m.update.mockImplementation(({ where, data }) => {
        if (where.status !== current.status)
          return Promise.reject({ code: "P2025" });
        Object.assign(current, data);
        return current;
      });
      const response = await createApp().request(
        `${BASE}/subscribers/${SUBSCRIBER_ID}`,
        json("PATCH", { status: "UNSUBSCRIBED" }),
      );
      expect(response.status).toBe(409);
      expect(current.status).toBe(status);
      expect(current.unsubscribedAt).toBeNull();
    },
  );

  it.each(["UNSUBSCRIBED", "BOUNCED"])(
    "retains a %s suppression record on deletion, including concurrent suppression",
    async (status) => {
      m.findUnique.mockResolvedValue({ ...SUBSCRIBER, status });
      m.deleteMany.mockImplementation(({ where }) => ({
        count: where.status.in.includes(status) ? 1 : 0,
      }));
      const response = await createApp().request(
        `${BASE}/subscribers/${SUBSCRIBER_ID}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(409);
      expect(m.deleteMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: SUBSCRIBER_ID,
          newsletterId: NEWSLETTER_ID,
          status: { in: ["ACTIVE", "PENDING"] },
        },
      });
      expect(m.createManyAndReturn).not.toHaveBeenCalled();
    },
  );

  it("scopes updates to this newsletter and rejects absent or foreign subscribers", async () => {
    m.findUnique.mockResolvedValue(null);
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { name: "New name" }),
    );
    expect(response.status).toBe(404);
    expect(m.findUnique).toHaveBeenCalledWith({
      where: { id: SUBSCRIBER_ID, newsletterId: NEWSLETTER_ID },
    });
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each(["ACTIVE", "PENDING"])(
    "deletes %s only within this newsletter and returns 404 for an absent subscriber",
    async (status) => {
      m.findUnique.mockResolvedValue({ ...SUBSCRIBER, status });
      const app = createApp();
      const response = await app.request(
        `${BASE}/subscribers/${SUBSCRIBER_ID}`,
        {
          method: "DELETE",
        },
      );
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(m.deleteMany).toHaveBeenCalledWith({
        where: {
          id: SUBSCRIBER_ID,
          newsletterId: NEWSLETTER_ID,
          status: { in: ["ACTIVE", "PENDING"] },
        },
      });
      m.deleteMany.mockResolvedValue({ count: 0 });
      m.findUnique.mockResolvedValue(null);
      expect(
        (
          await app.request(`${BASE}/subscribers/${SUBSCRIBER_ID}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(404);
    },
  );

  it.each(["UNSUBSCRIBED", "BOUNCED"] as const)(
    "retains %s suppression through delete, manual re-add and CSV re-import",
    async (status) => {
      let current: NewsletterSubscriber | null = { ...SUBSCRIBER, status };
      m.findUnique.mockImplementation(() => current);
      m.deleteMany.mockImplementation(
        ({ where }: Prisma.NewsletterSubscriberDeleteManyArgs) => {
          const allowed = where?.status;
          if (
            current &&
            typeof allowed === "object" &&
            Array.isArray(allowed.in) &&
            !allowed.in.includes(current.status)
          )
            return { count: 0 };
          current = null;
          return { count: 1 };
        },
      );
      m.createManyAndReturn.mockImplementation(() => {
        if (current) return [];
        current = { ...SUBSCRIBER };
        return [{ id: SUBSCRIBER_ID }];
      });
      const app = createApp();
      expect(
        (
          await app.request(`${BASE}/subscribers/${SUBSCRIBER_ID}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await app.request(
            `${BASE}/subscribers`,
            json("POST", {
              email: SUBSCRIBER.email,
              consent: "CONFIRMED",
            }),
          )
        ).status,
      ).toBe(409);
      const imported = await app.request(
        `${BASE}/subscribers/import`,
        json("POST", {
          csv: `email\n${SUBSCRIBER.email}`,
          consent: "CONFIRMED",
        }),
      );
      expect(imported.status).toBe(200);
      expect(await imported.json()).toMatchObject({
        data: { imported: 0, skippedExisting: 1, invalid: [] },
      });
      expect(current).toMatchObject({ status });
    },
  );

  it("cannot erase an unsubscribe that wins a race with deletion", async () => {
    let current: NewsletterSubscriber | null = { ...SUBSCRIBER };
    m.findUnique.mockImplementation(() => current);
    m.deleteMany.mockImplementation(
      ({ where }: Prisma.NewsletterSubscriberDeleteManyArgs) => {
        current = {
          ...SUBSCRIBER,
          status: "UNSUBSCRIBED",
          unsubscribedAt: NOW,
        };
        const allowed = where?.status;
        if (
          typeof allowed === "object" &&
          Array.isArray(allowed.in) &&
          !allowed.in.includes(current.status)
        )
          return { count: 0 };
        current = null;
        return { count: 1 };
      },
    );
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      {
        method: "DELETE",
      },
    );
    expect(response.status).toBe(409);
    expect(current).toMatchObject({
      status: "UNSUBSCRIBED",
      unsubscribedAt: NOW,
    });
  });
});

describe("newsletter subscriber CSV import", () => {
  it("imports ASK rows as pending and sends only new people a confirmation", async () => {
    m.createManyAndReturn.mockImplementation(({ data }) => [
      { ...SUBSCRIBER, ...data[0] },
    ]);
    m.findMany.mockResolvedValue([
      { status: "UNSUBSCRIBED" },
      { status: "BOUNCED" },
      { status: "PENDING" },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", {
        csv: "email\nada@example.com\nold@example.com\nbounced@example.com\npending@example.com",
        consent: "ASK",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        imported: 1,
        skippedExisting: 3,
        skippedUnsubscribed: 1,
        skippedBounced: 1,
        pendingConfirmation: 1,
      },
    });
    expect(
      m.createManyAndReturn.mock.calls[0][0].data.every(
        (row: { status: string }) => row.status === "PENDING",
      ),
    ).toBe(true);
    expect(m.sendEmail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        to: "ada@example.com",
        tag: "newsletter-confirmation",
      }),
    );
    expect(m.update).not.toHaveBeenCalled();
  });

  it("creates two contacts for three rows, reuses the email owner and files all three", async () => {
    m.channelFindMany.mockResolvedValue([
      { value: "ada@example.com", contactId: CONTACT_ID },
    ]);
    m.contactFindMany.mockResolvedValue([
      { id: CONTACT_ID, name: "Ada Lovelace", mergedIntoId: null },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", {
        csv: "email,name\nada@example.com,Changed name\nbea@example.com,Bea\ncy@example.com,Cy",
        consent: "CONFIRMED",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { imported: 3 } });
    expect(m.contactCreateMany).toHaveBeenCalledOnce();
    expect(
      m.contactCreateMany.mock.calls[0][0].data.map(
        (contact: { name: string }) => contact.name,
      ),
    ).toEqual(["Bea", "Cy"]);
    const rows = m.createManyAndReturn.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
    expect(rows[0].contactId).toBe(CONTACT_ID);
    expect(
      new Set(rows.map((row: { contactId: string }) => row.contactId)).size,
    ).toBe(3);
    expect(
      m.channelCreateMany.mock.calls[0][0].data.every(
        (channel: { source: string }) => channel.source === "IMPORT",
      ),
    ).toBe(true);
    expect(
      m.memberCreateMany.mock.calls[0][0].data.map(
        (row: { contactId: string }) => row.contactId,
      ),
    ).toEqual(rows.map((row: { contactId: string }) => row.contactId));
    expect(m.executeRaw).toHaveBeenCalledOnce();
  });

  it("counts new, duplicate, existing and invalid rows without resurrecting subscribers", async () => {
    const existing = new Map([
      ["old@example.com", "UNSUBSCRIBED"],
      ["bounce@example.com", "BOUNCED"],
      ["pending@example.com", "PENDING"],
    ]);
    m.createManyAndReturn.mockImplementation(
      ({
        data,
        skipDuplicates,
      }: {
        data: Prisma.NewsletterSubscriberCreateManyInput[];
        skipDuplicates: boolean;
      }) => {
        expect(skipDuplicates).toBe(true);
        const created = [];
        for (const row of data) {
          if (existing.has(row.email)) continue;
          existing.set(row.email, row.status ?? "PENDING");
          created.push({ ...SUBSCRIBER, ...row, id: row.email });
        }
        return created;
      },
    );
    m.findMany.mockResolvedValue(
      [...existing.values()].map((status) => ({ status })),
    );
    const csv =
      "name,email\nAda, ADA@Example.com \nDuplicate,ada@example.com\nOld,old@example.com\nBounced,bounce@example.com\nPending,pending@example.com\nBad,invalid\nBea,bea@example.com";
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv, consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        imported: 2,
        skippedExisting: 4,
        skippedUnsubscribed: 1,
        skippedBounced: 1,
        pendingConfirmation: 0,
        invalid: [{ row: 7, value: "invalid" }],
      },
    });
    expect(existing.get("old@example.com")).toBe("UNSUBSCRIBED");
    expect(existing.get("bounce@example.com")).toBe("BOUNCED");
    expect(existing.get("pending@example.com")).toBe("PENDING");
    expect(m.createEvents).toHaveBeenCalledExactlyOnceWith({
      data: ["ada@example.com", "bea@example.com"].map((id) => ({
        newsletterId: NEWSLETTER_ID,
        subscriberId: id,
        type: "CONFIRMED",
        occurredAt: expect.any(Date),
      })),
    });
    expect(m.createManyAndReturn.mock.calls[0][0].data).toContainEqual({
      newsletterId: NEWSLETTER_ID,
      contactId: expect.any(String),
      email: "ada@example.com",
      name: "Ada",
      status: "ACTIVE",
      source: "CSV_IMPORT",
      consentAt: expect.any(Date),
    });
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each([undefined, false])(
    "requires import consent: %s",
    async (consent) => {
      const response = await createApp().request(
        `${BASE}/subscribers/import`,
        json("POST", { csv: "email\na@example.com", consent }),
      );
      expect(response.status).toBe(422);
      expect(m.createManyAndReturn).not.toHaveBeenCalled();
    },
  );

  it.each(["Name\nAda", 'email\n"unclosed'])(
    "rejects invalid CSV before any inserts: %s",
    async (csv) => {
      const response = await createApp().request(
        `${BASE}/subscribers/import`,
        json("POST", { csv, consent: "CONFIRMED" }),
      );
      expect(response.status).toBe(422);
      expect(m.createManyAndReturn).not.toHaveBeenCalled();
    },
  );

  it("counts an entirely invalid file without inserting", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "email\nbad", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        imported: 0,
        skippedExisting: 0,
        invalid: [{ row: 2, value: "bad" }],
      },
    });
    expect(m.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("accepts and batches 50,000 rows below PostgreSQL's parameter limit", async () => {
    const csv = `email\n${Array.from({ length: 50_000 }, (_, index) => `person${index}@example.com`).join("\n")}`;
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv, consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { imported: 50_000, skippedExisting: 0, invalid: [] },
    });
    expect(m.contactCreateMany).toHaveBeenCalledTimes(50);
    expect(m.memberCreateMany).toHaveBeenCalledTimes(50);
    expect(m.executeRaw).toHaveBeenCalledTimes(50);
    expect(m.createManyAndReturn).toHaveBeenCalledTimes(50);
    expect(m.createEvents).toHaveBeenCalledTimes(50);
    expect(
      m.createManyAndReturn.mock.calls.every(
        ([input]) => input.data.length === 1000,
      ),
    ).toBe(true);
  });

  it("does not record activations for an import containing only existing subscribers", async () => {
    m.createManyAndReturn.mockResolvedValue([]);
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "email\nold@example.com", consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { imported: 0, skippedExisting: 1 },
    });
    expect(m.createEvents).not.toHaveBeenCalled();
  });

  it("enforces 5 MB by UTF-8 bytes", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "é".repeat(2_500_001), consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(422);
    expect(m.createManyAndReturn).not.toHaveBeenCalled();
  });
});

describe("newsletter subscribers from contacts", () => {
  const SECOND_CONTACT_ID = "88888888-8888-4888-8888-888888888888";
  const THIRD_CONTACT_ID = "99999999-9999-4999-8999-999999999999";
  const people = [
    { id: CONTACT_ID, name: "Ada", channels: [{ value: "ada@example.com" }] },
    {
      id: SECOND_CONTACT_ID,
      name: "Bea",
      channels: [{ value: "bea@example.com" }],
    },
    {
      id: THIRD_CONTACT_ID,
      name: "Cy",
      channels: [{ value: "cy@example.com" }],
    },
  ];

  function contacts(rows = people) {
    m.contactFindMany.mockImplementation(({ select, where }) =>
      select.channels
        ? rows
        : rows
            .filter((person) => where.id.in.includes(person.id))
            .map((person) => ({ ...person, mergedIntoId: null })),
    );
    m.channelFindMany.mockResolvedValue(
      rows.flatMap((person) =>
        person.channels.map((channel) => ({
          ...channel,
          contactId: person.id,
        })),
      ),
    );
    m.listFindFirst.mockResolvedValue({ id: LIST_ID, smartFilter: null });
  }

  it("adds two ids and an overlapping list once per person with CONFIRMED consent", async () => {
    contacts();
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", {
        contactIds: [CONTACT_ID, SECOND_CONTACT_ID],
        listIds: [LIST_ID],
        consent: "CONFIRMED",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        added: 3,
        alreadySubscribed: 0,
        skippedUnsubscribed: 0,
        skippedBounced: 0,
        skippedNoEmail: 0,
        pendingConfirmation: 0,
      },
    });
    const rows = m.createManyAndReturn.mock.calls[0][0].data;
    expect(rows.map((row: { email: string }) => row.email)).toEqual(
      people.map((person) => person.channels[0].value),
    );
    expect(
      rows.every(
        (row: { source: string; status: string }) =>
          row.source === "CONTACTS" && row.status === "ACTIVE",
      ),
    ).toBe(true);
    expect(rows.map((row: { contactId: string }) => row.contactId)).toEqual(
      people.map((person) => person.id),
    );
    expect(
      m.memberCreateMany.mock.calls[0][0].data.map(
        (row: { contactId: string }) => row.contactId,
      ),
    ).toEqual(people.map((person) => person.id));
    expect(m.contactFindMany.mock.calls[1][0]).toMatchObject({
      where: {
        workspaceId: WORKSPACE_ID,
        archivedAt: null,
        mergedIntoId: null,
        OR: [
          { id: { in: [CONTACT_ID, SECOND_CONTACT_ID] } },
          { AND: [{ listMemberships: { some: { listId: LIST_ID } } }] },
        ],
      },
    });
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("skips contacts without email and chooses primary email then oldest email", async () => {
    contacts([{ ...people[0], channels: [] }, people[1]]);
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", {
        contactIds: [CONTACT_ID, SECOND_CONTACT_ID],
        consent: "CONFIRMED",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { added: 1, skippedNoEmail: 1 },
    });
    expect(m.createManyAndReturn.mock.calls[0][0].data[0].email).toBe(
      "bea@example.com",
    );
    expect(m.contactFindMany.mock.calls[1][0].select.channels).toEqual({
      where: { type: "EMAIL" },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 1,
      select: { value: true },
    });
  });

  it("counts existing statuses without reactivating or emailing them", async () => {
    contacts();
    m.createManyAndReturn.mockResolvedValue([]);
    m.findMany.mockResolvedValue([
      { status: "UNSUBSCRIBED" },
      { status: "BOUNCED" },
      { status: "PENDING" },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", { listIds: [LIST_ID], consent: "ASK" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        added: 0,
        skippedUnsubscribed: 1,
        skippedBounced: 1,
        alreadySubscribed: 1,
        pendingConfirmation: 0,
      },
    });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("creates ASK people as pending and confirms each new person once", async () => {
    contacts();
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", {
        contactIds: [CONTACT_ID, CONTACT_ID, SECOND_CONTACT_ID],
        listIds: [LIST_ID],
        consent: "ASK",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { added: 3, pendingConfirmation: 3 },
    });
    expect(
      m.createManyAndReturn.mock.calls[0][0].data.every(
        (row: { status: string }) => row.status === "PENDING",
      ),
    ).toBe(true);
    expect(m.sendEmail).toHaveBeenCalledTimes(3);
    expect(m.sendEmail.mock.calls.map(([mail]) => mail.to)).toEqual(
      people.map((person) => person.channels[0].value),
    );
    expect(m.redis).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `newsletter:signup:${NEWSLETTER_ID}:unknown`,
    );
    m.createManyAndReturn.mockResolvedValue([]);
    m.findMany.mockResolvedValue(people.map(() => ({ status: "PENDING" })));
    const retry = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", { listIds: [LIST_ID], consent: "ASK" }),
    );
    expect(await retry.json()).toMatchObject({
      data: { added: 0, alreadySubscribed: 3, pendingConfirmation: 0 },
    });
    expect(m.sendEmail).toHaveBeenCalledTimes(3);
  });

  it.each(["ACTIVE", "PENDING"])(
    "counts an existing %s subscriber and fills only a missing contact link",
    async (status) => {
      contacts([people[0]]);
      m.createManyAndReturn.mockResolvedValue([]);
      m.findMany.mockResolvedValue([{ status }]);
      const response = await createApp().request(
        `${BASE}/subscribers/from-contacts`,
        json("POST", { contactIds: [CONTACT_ID], consent: "CONFIRMED" }),
      );
      expect(await response.json()).toMatchObject({
        data: { added: 0, alreadySubscribed: 1 },
      });
      const query = relinkQuery();
      expect(query?.sql).toContain('subscriber."contactId" IS NULL');
      expect(query?.sql).toContain(
        "subscriber.status IN ('ACTIVE', 'PENDING')",
      );
      expect(query?.values).toEqual([
        "ada@example.com",
        CONTACT_ID,
        NEWSLETTER_ID,
      ]);
      expect(m.update).not.toHaveBeenCalled();
      expect(m.sendEmail).not.toHaveBeenCalled();
    },
  );

  it("skips an archived contact without counting it as missing email", async () => {
    contacts([people[0]]);
    m.contactFindMany
      .mockResolvedValueOnce([
        { id: CONTACT_ID, name: "Ada", mergedIntoId: null },
      ])
      .mockResolvedValueOnce([]);
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", { contactIds: [CONTACT_ID], consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        added: 0,
        alreadySubscribed: 0,
        skippedUnsubscribed: 0,
        skippedBounced: 0,
        skippedNoEmail: 0,
        pendingConfirmation: 0,
      },
    });
    expect(m.contactFindMany.mock.calls[1][0].where.archivedAt).toBeNull();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("evaluates smart lists with the existing contact filter", async () => {
    contacts([people[0]]);
    m.listFindFirst.mockResolvedValue({
      id: LIST_ID,
      smartFilter: { stages: ["LEAD"], hasChannel: "EMAIL" },
    });
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", { listIds: [LIST_ID], consent: "CONFIRMED" }),
    );
    expect(response.status).toBe(200);
    expect(m.contactFindMany.mock.calls[0][0].where.OR[1]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      archivedAt: null,
      mergedIntoId: null,
      AND: [
        { stage: { in: ["LEAD"] } },
        { channels: { some: { type: "EMAIL" } } },
      ],
    });
    expect(m.createManyAndReturn.mock.calls[0][0].data[0].contactId).toBe(
      CONTACT_ID,
    );
  });

  it("resolves merged ids to one survivor", async () => {
    contacts([people[0]]);
    m.contactFindMany.mockResolvedValueOnce([
      { id: SECOND_CONTACT_ID, name: "Old Ada", mergedIntoId: CONTACT_ID },
      { id: CONTACT_ID, name: "Ada", mergedIntoId: null },
    ]);
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", {
        contactIds: [SECOND_CONTACT_ID, CONTACT_ID],
        consent: "CONFIRMED",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { added: 1 } });
    expect(m.contactFindMany.mock.calls[1][0].where.OR[0]).toEqual({
      id: { in: [CONTACT_ID] },
    });
    expect(m.createManyAndReturn.mock.calls[0][0].data[0].contactId).toBe(
      CONTACT_ID,
    );
  });

  it.each(["contactIds", "listIds"])(
    "returns 404 for absent or foreign workspace %s before writing",
    async (field) => {
      const response = await createApp().request(
        `${BASE}/subscribers/from-contacts`,
        json("POST", { [field]: [CONTACT_ID], consent: "CONFIRMED" }),
      );
      expect(response.status).toBe(404);
      expect(m.createManyAndReturn).not.toHaveBeenCalled();
      expect(m.transaction).not.toHaveBeenCalled();
      if (field === "contactIds")
        expect(m.contactFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { workspaceId: WORKSPACE_ID, id: { in: [CONTACT_ID] } },
          }),
        );
      else
        expect(m.listFindFirst).toHaveBeenCalledWith({
          where: { id: CONTACT_ID, workspaceId: WORKSPACE_ID },
        });
    },
  );

  it.each([
    { contactIds: [CONTACT_ID] },
    { contactIds: [CONTACT_ID], consent: true },
    { contactIds: [], listIds: [], consent: "ASK" },
    { contactIds: Array(1001).fill(CONTACT_ID), consent: "CONFIRMED" },
    { listIds: Array(21).fill(LIST_ID), consent: "CONFIRMED" },
  ])("rejects missing consent or invalid selection %#", async (body) => {
    const response = await createApp().request(
      `${BASE}/subscribers/from-contacts`,
      json("POST", body),
    );
    expect(response.status).toBe(422);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it.each(["subscribers", "subscribers/import", "subscribers/from-contacts"])(
    "applies the signup rate limit to ASK on %s before writing",
    async (path) => {
      contacts();
      m.redis.mockResolvedValue(11);
      const response = await createApp().request(
        `${BASE}/${path}`,
        json("POST", {
          email: "ada@example.com",
          csv: "email\nada@example.com",
          contactIds: [CONTACT_ID],
          consent: "ASK",
        }),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("600");
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m.sendEmail).not.toHaveBeenCalled();
    },
  );
});
