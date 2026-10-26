import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import {
  getNewsletterAnalytics,
  getNewsletterIssueAnalytics,
  newsletterAnalyticsRange,
} from "./newsletter-analytics.service";

const m = vi.hoisted(() => ({
  newsletter: vi.fn(),
  raw: vi.fn(),
  sent: vi.fn(),
  active: vi.fn(),
  issue: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@/services/newsletter.service", () => ({
  getNewsletter: m.newsletter,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: m.raw,
    newsletterSend: { count: m.sent },
    newsletterSubscriber: { count: m.active },
    newsletterIssue: { findUnique: m.issue },
    workspace: { findFirst: m.workspace },
  },
}));

const NEWSLETTER_ID = "33333333-3333-4333-8333-333333333333";
const ISSUE_ID = "44444444-4444-4444-8444-444444444444";
const SCOPE = {
  projectId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};
const COUNTS = {
  delivered: 8,
  uniqueOpens: 4,
  uniqueClicks: 2,
  unsubscribes: 1,
  bounces: 1,
  complaints: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  m.newsletter.mockResolvedValue({ id: NEWSLETTER_ID });
  m.workspace.mockResolvedValue({ id: SCOPE.workspaceId });
  m.issue.mockResolvedValue({ id: ISSUE_ID });
  m.sent.mockResolvedValue(10);
  m.active.mockResolvedValue(9);
  m.raw.mockImplementation((sql: Prisma.Sql) =>
    sql.sql.includes("AS count FROM")
      ? [{ count: 1 }]
      : /^\s*SELECT\s+COUNT\(DISTINCT/.test(sql.sql)
        ? [COUNTS]
        : [],
  );
});

describe("newsletter analytics aggregation", () => {
  it("uses delivered denominators and scopes every grouped read to the newsletter and UTC period", async () => {
    const result = await getNewsletterAnalytics(SCOPE, {
      from: "2026-10-01",
      to: "2026-10-02",
    });
    expect(result.totals).toEqual({
      sent: 10,
      activeSubscribers: 9,
      ...COUNTS,
      openRate: 0.5,
      clickRate: 0.25,
    });
    expect(m.newsletter).toHaveBeenCalledExactlyOnceWith(SCOPE);
    expect(m.sent).toHaveBeenCalledWith({
      where: {
        issue: { newsletterId: NEWSLETTER_ID },
        status: "SENT",
        sentAt: {
          gte: new Date("2026-10-01T00:00:00Z"),
          lt: new Date("2026-10-03T00:00:00Z"),
        },
      },
    });
    for (const [sql] of m.raw.mock.calls) {
      expect(sql.values).toContain(NEWSLETTER_ID);
      expect(sql.sql).not.toContain(NEWSLETTER_ID);
    }
    const aggregate = m.raw.mock.calls[0]![0] as Prisma.Sql;
    expect(aggregate.sql).toContain('COUNT(DISTINCT "subscriberId")');
    expect(aggregate.sql).toContain('COUNT(DISTINCT "sendId")');
    expect(m.raw.mock.calls).toHaveLength(5);
  });

  it("falls back to sent counts and returns finite zeros for an empty newsletter", async () => {
    m.raw.mockImplementation((sql: Prisma.Sql) =>
      /^\s*SELECT\s+COUNT\(DISTINCT/.test(sql.sql)
        ? [{ ...COUNTS, delivered: 0 }]
        : [],
    );
    expect(
      (await getNewsletterIssueAnalytics(SCOPE, ISSUE_ID)).totals,
    ).toMatchObject({ openRate: 0.4, clickRate: 0.2 });
    m.sent.mockResolvedValue(0);
    m.active.mockResolvedValue(0);
    m.raw.mockResolvedValue([]);
    expect((await getNewsletterAnalytics(SCOPE, {})).totals).toEqual({
      sent: 0,
      delivered: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      unsubscribes: 0,
      bounces: 0,
      complaints: 0,
      openRate: 0,
      clickRate: 0,
      activeSubscribers: 0,
    });
  });

  it("authorizes issue ownership before aggregating lifetime counts and distinct link clicks", async () => {
    await getNewsletterIssueAnalytics(SCOPE, ISSUE_ID);
    expect(m.issue).toHaveBeenCalledWith({
      where: { ...SCOPE, newsletterId: NEWSLETTER_ID, id: ISSUE_ID },
      select: { id: true },
    });
    expect(m.raw.mock.calls[0]![0].values).toEqual([NEWSLETTER_ID, ISSUE_ID]);
    const links = m.raw.mock.calls[1]![0] as Prisma.Sql;
    expect(links.sql).toContain('COUNT(DISTINCT "subscriberId")');
    expect(links.sql).toContain(
      'GROUP BY url ORDER BY "uniqueClicks" DESC, url ASC LIMIT 20',
    );
    m.raw.mockClear();
    m.issue.mockResolvedValue(null);
    await expect(
      getNewsletterIssueAnalytics(SCOPE, ISSUE_ID),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.raw).not.toHaveBeenCalled();
  });

  it("does no aggregates for an inaccessible project or missing newsletter", async () => {
    m.newsletter.mockRejectedValue(notFound("Newsletter not found"));
    await expect(getNewsletterAnalytics(SCOPE, {})).rejects.toMatchObject({
      status: 404,
    });
    expect(m.raw).not.toHaveBeenCalled();
  });

  it.each(["project", "issue"])(
    "rejects %s analytics outside the project's utxo workspace before aggregation",
    async (kind) => {
      m.workspace.mockResolvedValue(null);
      await expect(
        kind === "project"
          ? getNewsletterAnalytics(SCOPE, {})
          : getNewsletterIssueAnalytics(SCOPE, ISSUE_ID),
      ).rejects.toMatchObject({ status: 404 });
      expect(m.workspace).toHaveBeenCalledWith({
        where: { id: SCOPE.workspaceId, organization: { slug: "utxo" } },
        select: { id: true },
      });
      expect(m.raw).not.toHaveBeenCalled();
      expect(m.sent).not.toHaveBeenCalled();
      expect(m.issue).not.toHaveBeenCalled();
    },
  );

  it("reports unavailable issue unsubscribe attribution instead of zero", async () => {
    expect(
      (await getNewsletterIssueAnalytics(SCOPE, ISSUE_ID)).totals.unsubscribes,
    ).toBeNull();
  });
});

describe("newsletter analytics dates", () => {
  it("uses inclusive UTC dates, fills a default 30-day range and accepts leap days", () => {
    expect(newsletterAnalyticsRange({ to: "2024-03-01" })).toEqual({
      from: "2024-02-01",
      to: "2024-03-01",
      start: new Date("2024-02-01T00:00:00Z"),
      end: new Date("2024-03-02T00:00:00Z"),
    });
    expect(
      newsletterAnalyticsRange({ from: "2024-02-29", to: "2024-02-29" }).end,
    ).toEqual(new Date("2024-03-01T00:00:00Z"));
  });
  it.each([
    { from: "2026-10-03", to: "2026-10-01" },
    { from: "2024-01-01", to: "2025-01-01" },
  ])(
    "rejects reversed and oversized ranges before queries: %j",
    async (query) => {
      await expect(getNewsletterAnalytics(SCOPE, query)).rejects.toMatchObject({
        status: 422,
      });
      expect(m.newsletter).not.toHaveBeenCalled();
    },
  );
});
