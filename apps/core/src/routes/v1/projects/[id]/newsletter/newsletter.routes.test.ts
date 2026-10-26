import { OpenAPIHono } from "@hono/zod-openapi";
import type {
  Newsletter,
  NewsletterSubscriber,
  Prisma,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountGet from "./get";
import mountPut from "./put";
import mountDelete from "./subscribers/[subscriberId]/delete";
import mountPatch from "./subscribers/[subscriberId]/patch";
import mountList from "./subscribers/get";
import mountImport from "./subscribers/import/post";
import mountAdd from "./subscribers/post";

const m = vi.hoisted(() => ({
  enabled: true,
  workspaceFindUnique: vi.fn(),
  projectFindFirst: vi.fn(),
  newsletterFindUnique: vi.fn(),
  newsletterUpsert: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
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
    workspace: { findUnique: m.workspaceFindUnique },
    project: { findFirst: m.projectFindFirst },
    newsletter: {
      findUnique: m.newsletterFindUnique,
      upsert: m.newsletterUpsert,
    },
    newsletterSubscriber: {
      findMany: m.findMany,
      count: m.count,
      groupBy: m.groupBy,
      create: m.create,
      findUnique: m.findUnique,
      update: m.update,
      deleteMany: m.deleteMany,
      createMany: m.createMany,
    },
  },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const NEWSLETTER_ID = "33333333-3333-4333-8333-333333333333";
const SUBSCRIBER_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_SUBSCRIBER_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-10-23T10:00:00Z");
const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: "user_1",
  organizationId: null,
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
  email: "ada@example.com",
  name: "Ada",
  status: "ACTIVE",
  source: "MANUAL",
  consentAt: NOW,
  confirmedAt: null,
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
      json("POST", { email: "ada@example.com", consent: true }),
    ),
    app.request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "email\na@example.com", consent: true }),
    ),
    app.request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { name: "New name" }),
    ),
    app.request(`${BASE}/subscribers/${SUBSCRIBER_ID}`, { method: "DELETE" }),
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.workspaceFindUnique.mockResolvedValue({ organization: { slug: "utxo" } });
  m.projectFindFirst.mockResolvedValue({
    id: PROJECT_ID,
    closingAt: null,
    closedAt: null,
  });
  m.newsletterFindUnique.mockResolvedValue(NEWSLETTER);
  m.newsletterUpsert.mockResolvedValue(NEWSLETTER);
  m.findMany.mockResolvedValue([SUBSCRIBER]);
  m.count.mockResolvedValue(1);
  m.groupBy.mockResolvedValue([{ status: "ACTIVE", _count: { _all: 1 } }]);
  m.create.mockResolvedValue(SUBSCRIBER);
  m.findUnique.mockResolvedValue(SUBSCRIBER);
  m.update.mockResolvedValue(SUBSCRIBER);
  m.deleteMany.mockResolvedValue({ count: 1 });
  m.createMany.mockImplementation(
    ({ data }: { data: Prisma.NewsletterSubscriberCreateManyInput[] }) => ({
      count: data.length,
    }),
  );
});

describe("Project newsletter access", () => {
  it("returns 404 on every route before access checks or DB work when disabled", async () => {
    m.enabled = false;
    const responses = await Promise.all(allOperations(createApp(AUTH, null)));
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        message: "Newsletter is not enabled",
      });
    }
    expect(m.projectFindFirst).not.toHaveBeenCalled();
    expect(m.workspaceFindUnique).not.toHaveBeenCalled();
    expect(m.newsletterFindUnique).not.toHaveBeenCalled();
    expect(m.newsletterUpsert).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.createMany).not.toHaveBeenCalled();
  });

  it("requires authentication and a workspace on every route", async () => {
    const unauthorizedResponses = await Promise.all(
      allOperations(createApp(null)),
    );
    expect(unauthorizedResponses.map((response) => response.status)).toEqual(
      Array(7).fill(401),
    );
    const forbiddenResponses = await Promise.all(
      allOperations(createApp(AUTH, null)),
    );
    expect(forbiddenResponses.map((response) => response.status)).toEqual(
      Array(7).fill(403),
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
      Array(7).fill(404),
    );
    expect(m.workspaceFindUnique).toHaveBeenCalledWith({
      where: { id: WORKSPACE_ID },
      select: { organization: { select: { slug: true } } },
    });
    expect(m.projectFindFirst).not.toHaveBeenCalled();
    expect(m.newsletterFindUnique).not.toHaveBeenCalled();
    expect(m.newsletterUpsert).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.createMany).not.toHaveBeenCalled();
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
      Array(7).fill(403),
    );
    expect(m.projectFindFirst).not.toHaveBeenCalled();
  });

  it("requires the project in the active workspace on every route", async () => {
    m.projectFindFirst.mockResolvedValue(null);
    const responses = await Promise.all(allOperations());
    expect(responses.map((response) => response.status)).toEqual(
      Array(7).fill(404),
    );
    expect(m.projectFindFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: { id: true, closingAt: true, closedAt: true },
    });
    expect(m.newsletterFindUnique).not.toHaveBeenCalled();
    expect(m.newsletterUpsert).not.toHaveBeenCalled();
  });

  it("returns 404 for absent newsletter settings", async () => {
    m.newsletterFindUnique.mockResolvedValue(null);
    const responses = await Promise.all(allOperations());
    expect(responses.map((response) => response.status)).toEqual([
      404, 200, 404, 404, 404, 404, 404,
    ]);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.createMany).not.toHaveBeenCalled();
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
  it("adds an active manual subscriber with normalized email and consent time", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", {
        email: " ADA@Example.com ",
        name: " Ada ",
        consent: true,
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { email: "ada@example.com", status: "ACTIVE", source: "MANUAL" },
    });
    expect(m.create).toHaveBeenCalledWith({
      data: {
        newsletterId: NEWSLETTER_ID,
        email: "ada@example.com",
        name: "Ada",
        status: "ACTIVE",
        source: "MANUAL",
        consentAt: expect.any(Date),
      },
    });
  });

  it.each([undefined, false])(
    "requires explicit consent: %s",
    async (consent) => {
      const response = await createApp().request(
        `${BASE}/subscribers`,
        json("POST", { email: "ada@example.com", consent }),
      );
      expect(response.status).toBe(422);
      expect(m.create).not.toHaveBeenCalled();
    },
  );

  it("returns 409 for a duplicate without updating it", async () => {
    m.create.mockRejectedValue({ code: "P2002" });
    const response = await createApp().request(
      `${BASE}/subscribers`,
      json("POST", { email: "ADA@example.com", consent: true }),
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
        email: { contains: "ADA", mode: "insensitive" },
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
      },
    });
  });

  it("refuses to reactivate an unsubscribed subscriber", async () => {
    m.findUnique.mockResolvedValue({
      ...SUBSCRIBER,
      status: "UNSUBSCRIBED",
      unsubscribedAt: NOW,
    });
    const response = await createApp().request(
      `${BASE}/subscribers/${SUBSCRIBER_ID}`,
      json("PATCH", { status: "ACTIVE" }),
    );
    expect(response.status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each(["UNSUBSCRIBED", "BOUNCED"] as const)(
    "cannot overwrite a concurrent %s status with a redundant ACTIVE patch",
    async (status) => {
      let current: NewsletterSubscriber = { ...SUBSCRIBER };
      m.findUnique.mockImplementation(() => {
        const before = { ...current };
        current = { ...current, status };
        return before;
      });
      m.update.mockImplementation(
        ({ where, data }: Prisma.NewsletterSubscriberUpdateArgs) => {
          if (where.status && where.status !== current.status)
            throw { code: "P2025" };
          if (data.status === "ACTIVE") current.status = "ACTIVE";
          return current;
        },
      );
      const response = await createApp().request(
        `${BASE}/subscribers/${SUBSCRIBER_ID}`,
        json("PATCH", { status: "ACTIVE" }),
      );
      expect(response.status).toBe(409);
      expect(current.status).toBe(status);
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

  it.each(["PENDING", "BOUNCED"])(
    "cannot manually leave %s",
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
        data: { name: "New name", status: undefined },
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
  });

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

  it("deletes only within this newsletter and returns 404 for an absent subscriber", async () => {
    const app = createApp();
    const response = await app.request(`${BASE}/subscribers/${SUBSCRIBER_ID}`, {
      method: "DELETE",
    });
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
  });

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
      m.create.mockImplementation(() => {
        if (current) throw { code: "P2002" };
        current = { ...SUBSCRIBER };
        return current;
      });
      m.createMany.mockImplementation(() => {
        if (current) return { count: 0 };
        current = { ...SUBSCRIBER };
        return { count: 1 };
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
              consent: true,
            }),
          )
        ).status,
      ).toBe(409);
      const imported = await app.request(
        `${BASE}/subscribers/import`,
        json("POST", { csv: `email\n${SUBSCRIBER.email}`, consent: true }),
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
  it("counts new, duplicate, existing and invalid rows without resurrecting subscribers", async () => {
    const existing = new Map([
      ["old@example.com", "UNSUBSCRIBED"],
      ["bounce@example.com", "BOUNCED"],
      ["pending@example.com", "PENDING"],
    ]);
    m.createMany.mockImplementation(
      ({
        data,
        skipDuplicates,
      }: {
        data: Prisma.NewsletterSubscriberCreateManyInput[];
        skipDuplicates: boolean;
      }) => {
        expect(skipDuplicates).toBe(true);
        let count = 0;
        for (const row of data) {
          if (existing.has(row.email)) continue;
          existing.set(row.email, row.status ?? "PENDING");
          count++;
        }
        return { count };
      },
    );
    const csv =
      "name,email\nAda, ADA@Example.com \nDuplicate,ada@example.com\nOld,old@example.com\nBounced,bounce@example.com\nPending,pending@example.com\nBad,invalid\nBea,bea@example.com";
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv, consent: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        imported: 2,
        skippedExisting: 4,
        invalid: [{ row: 7, value: "invalid" }],
      },
    });
    expect(existing.get("old@example.com")).toBe("UNSUBSCRIBED");
    expect(existing.get("bounce@example.com")).toBe("BOUNCED");
    expect(existing.get("pending@example.com")).toBe("PENDING");
    expect(m.createMany.mock.calls[0][0].data).toContainEqual({
      newsletterId: NEWSLETTER_ID,
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
      expect(m.createMany).not.toHaveBeenCalled();
    },
  );

  it.each(["Name\nAda", 'email\n"unclosed'])(
    "rejects invalid CSV before any inserts: %s",
    async (csv) => {
      const response = await createApp().request(
        `${BASE}/subscribers/import`,
        json("POST", { csv, consent: true }),
      );
      expect(response.status).toBe(422);
      expect(m.createMany).not.toHaveBeenCalled();
    },
  );

  it("counts an entirely invalid file without inserting", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "email\nbad", consent: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        imported: 0,
        skippedExisting: 0,
        invalid: [{ row: 2, value: "bad" }],
      },
    });
    expect(m.createMany).not.toHaveBeenCalled();
  });

  it("accepts and batches 50,000 rows below PostgreSQL's parameter limit", async () => {
    const csv = `email\n${Array.from({ length: 50_000 }, (_, index) => `person${index}@example.com`).join("\n")}`;
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv, consent: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { imported: 50_000, skippedExisting: 0, invalid: [] },
    });
    expect(m.createMany).toHaveBeenCalledTimes(50);
    expect(
      m.createMany.mock.calls.every(([input]) => input.data.length === 1000),
    ).toBe(true);
  });

  it("enforces 5 MB by UTF-8 bytes", async () => {
    const response = await createApp().request(
      `${BASE}/subscribers/import`,
      json("POST", { csv: "é".repeat(2_500_001), consent: true }),
    );
    expect(response.status).toBe(422);
    expect(m.createMany).not.toHaveBeenCalled();
  });
});
