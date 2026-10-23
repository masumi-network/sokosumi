import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import {
  NEWSLETTER,
  NEWSLETTER_ISSUE,
  NEWSLETTER_NOW,
} from "@/test/newsletter";

import router from "../index";

const m = vi.hoisted(() => ({
  enabled: true,
  newsletter: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
  issue: vi.fn(),
  subscriber: vi.fn(),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NEWSLETTER_ENABLED: m.enabled,
      WEB_APP_BASE_URL: "https://web.example.com",
    }),
  };
});
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletter: { findUnique: m.newsletter },
    newsletterIssue: { findMany: m.list, count: m.count, findFirst: m.issue },
    newsletterSubscriber: { findMany: m.subscriber },
  },
}));

function app() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "public_archive_test");
    await next();
  });
  app.route("/v1/public/newsletters", router);
  app.onError(errorHandler);
  return app;
}

const URL = `http://localhost/v1/public/newsletters/${NEWSLETTER.publicSlug}/issues`;
const ISSUE_URL = `${URL}/${NEWSLETTER_ISSUE.publicSlug}`;
const SENT_ISSUE = {
  ...NEWSLETTER_ISSUE,
  status: "SENT",
  sentAt: NEWSLETTER_NOW,
  newsletter: NEWSLETTER,
  subscribers: [{ email: "private@example.com" }],
};
const WHERE = {
  newsletterId: NEWSLETTER.id,
  status: "SENT",
  sentAt: { not: null },
};

beforeEach(() => {
  vi.resetAllMocks();
  m.enabled = true;
  m.newsletter.mockResolvedValue({ id: NEWSLETTER.id });
  m.list.mockResolvedValue([SENT_ISSUE]);
  m.count.mockResolvedValue(1);
  m.issue.mockResolvedValue(SENT_ISSUE);
});

describe("public newsletter archive", () => {
  it("lists only sent issue summaries anonymously, with stable newest-first ordering", async () => {
    const response = await app().request(URL);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300");
    const body = await response.json();
    expect(body.data).toEqual([
      {
        publicSlug: SENT_ISSUE.publicSlug,
        subject: SENT_ISSUE.subject,
        previewText: null,
        sentAt: NEWSLETTER_NOW.toISOString(),
      },
    ]);
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 20,
      total: 1,
      nextCursor: null,
    });
    expect(m.newsletter).toHaveBeenCalledWith({
      where: { publicSlug: NEWSLETTER.publicSlug },
      select: { id: true },
    });
    expect(m.list).toHaveBeenCalledWith({
      where: WHERE,
      select: {
        id: true,
        publicSlug: true,
        subject: true,
        previewText: true,
        sentAt: true,
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: 21,
      skip: undefined,
      cursor: undefined,
    });
    expect(m.count).toHaveBeenCalledWith({ where: WHERE });
    expect(m.subscriber).not.toHaveBeenCalled();
  });

  it("paginates with take+1 and skips the cursor on the next page", async () => {
    m.list.mockResolvedValue([
      SENT_ISSUE,
      { ...SENT_ISSUE, id: "66666666-6666-4666-8666-666666666666" },
    ]);
    m.count.mockResolvedValue(2);
    const response = await app().request(`${URL}?limit=1`);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.pagination.nextCursor).toBe(SENT_ISSUE.id);
    m.list.mockResolvedValue([]);
    const next = await app().request(`${URL}?limit=1&cursor=${SENT_ISSUE.id}`);
    expect((await next.json()).meta.pagination.nextCursor).toBeNull();
    expect(m.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: WHERE,
        take: 2,
        skip: 1,
        cursor: { id: SENT_ISSUE.id },
      }),
    );
  });

  it("returns an empty archive for a known newsletter and 404 for an unknown one", async () => {
    m.list.mockResolvedValue([]);
    m.count.mockResolvedValue(0);
    expect((await (await app().request(URL)).json()).data).toEqual([]);
    m.newsletter.mockResolvedValue(null);
    const response = await app().request(URL);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  it.each(["limit=0", "limit=101", "cursor=bad"])(
    "rejects invalid pagination: %s",
    async (query) => {
      expect((await app().request(`${URL}?${query}`)).status).toBe(422);
      expect(m.list).not.toHaveBeenCalled();
    },
  );

  it.each([URL, ISSUE_URL])(
    "returns 404 before data access when disabled: %s",
    async (url) => {
      m.enabled = false;
      const response = await app().request(url);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBeNull();
      expect(m.newsletter).not.toHaveBeenCalled();
      expect(m.issue).not.toHaveBeenCalled();
      expect(m.list).not.toHaveBeenCalled();
    },
  );

  it("renders a sent issue in web mode without subscriber data, unsubscribe tokens or email headers", async () => {
    const response = await app().request(`${ISSUE_URL}?locale=de`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300");
    expect(response.headers.get("List-Unsubscribe")).toBeNull();
    expect(response.headers.get("List-Unsubscribe-Post")).toBeNull();
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual([
      "html",
      "previewText",
      "sentAt",
      "subject",
    ]);
    expect(body.data).toMatchObject({
      subject: SENT_ISSUE.subject,
      previewText: null,
      sentAt: NEWSLETTER_NOW.toISOString(),
    });
    expect(body.data.html).toContain("Abonnieren");
    expect(body.data.html).toContain(
      `href="https://web.example.com/n/${NEWSLETTER.publicSlug}"`,
    );
    expect(body.data.html).not.toContain("unsubscribe");
    expect(body.data.html).not.toContain("token=");
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(m.issue).toHaveBeenCalledWith({
      where: {
        publicSlug: SENT_ISSUE.publicSlug,
        newsletter: { publicSlug: NEWSLETTER.publicSlug },
        status: "SENT",
        sentAt: { not: null },
      },
      select: {
        subject: true,
        previewText: true,
        sentAt: true,
        template: true,
        content: true,
        newsletter: { select: { name: true, brand: true } },
      },
    });
    expect(m.subscriber).not.toHaveBeenCalled();
  });

  it.each(["missing-newsletter", NEWSLETTER.publicSlug])(
    "returns 404 for missing, unsent or other-newsletter issues under %s",
    async (slug) => {
      m.issue.mockResolvedValue(null);
      const response = await app().request(
        `http://localhost/v1/public/newsletters/${slug}/issues/${SENT_ISSUE.publicSlug}`,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBeNull();
      expect(m.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            publicSlug: SENT_ISSUE.publicSlug,
            newsletter: { publicSlug: slug },
            status: "SENT",
            sentAt: { not: null },
          },
        }),
      );
    },
  );
});
