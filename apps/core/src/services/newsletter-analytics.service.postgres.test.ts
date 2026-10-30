import type { Prisma } from "@sokosumi/database";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getNewsletterAnalytics,
  getNewsletterIssueAnalytics,
} from "./newsletter-analytics.service";

const m = vi.hoisted(() => ({ raw: vi.fn() }));
vi.mock("@/services/newsletter.service", () => ({
  getNewsletter: vi.fn(async () => ({
    id: "33333333-3333-4333-8333-333333333333",
  })),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: m.raw,
    newsletterSend: { count: vi.fn(async () => 2) },
    newsletterSubscriber: { count: vi.fn(async () => 2) },
    newsletterIssue: { findUnique: vi.fn(async () => ({ id: "issue" })) },
  },
}));

const NEWSLETTER = "33333333-3333-4333-8333-333333333333";
const OTHER_NEWSLETTER = "99999999-9999-4999-8999-999999999999";
const ISSUE = "44444444-4444-4444-8444-444444444444";
const OTHER_ISSUE = "55555555-5555-4555-8555-555555555555";
const SCOPE = {
  projectId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};
const RANGE = { from: "2026-10-01", to: "2026-10-04" };

// Only temporary tables on this connection; never uses the application's DATABASE_URL.
describe.runIf(process.env.NEWSLETTER_ANALYTICS_TEST_DATABASE_URL)(
  "newsletter analytics SQL behaviour",
  () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({
        connectionString: process.env.NEWSLETTER_ANALYTICS_TEST_DATABASE_URL,
      });
      await client.connect();
      await client.query(`
      CREATE TEMP TABLE newsletter_subscriber (
        id uuid, "newsletterId" uuid, "createdAt" timestamp, "confirmedAt" timestamp,
        "unsubscribedAt" timestamp, "bouncedAt" timestamp, source text, status text
      );
      CREATE TEMP TABLE newsletter_event (
        "newsletterId" uuid, "issueId" uuid, "subscriberId" uuid, "sendId" uuid,
        type text, url text, "occurredAt" timestamp
      );
      CREATE TEMP TABLE newsletter_issue (
        id uuid, "newsletterId" uuid, subject text, "sentAt" timestamp, status text
      );
      CREATE TEMP TABLE newsletter_send ("issueId" uuid, status text, "sentAt" timestamp);
    `);
    });
    afterAll(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(
        "TRUNCATE newsletter_subscriber, newsletter_event, newsletter_issue, newsletter_send",
      );
      m.raw.mockImplementation(
        async (query: Prisma.Sql) =>
          (await client.query(query.text, query.values)).rows,
      );
    });

    async function subscriber(
      id: number,
      source: string,
      created: string,
      confirmed: string | null,
      unsubscribed: string | null,
      bounced: string | null,
      newsletter = NEWSLETTER,
    ) {
      const subscriberId = `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
      await client.query(
        "INSERT INTO newsletter_subscriber VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          subscriberId,
          newsletter,
          created,
          confirmed,
          unsubscribed,
          bounced,
          source,
          unsubscribed ? "UNSUBSCRIBED" : bounced ? "BOUNCED" : "ACTIVE",
        ],
      );
      return subscriberId;
    }
    async function event(
      subscriberId: string | null,
      type: string,
      at: string,
      issueId: string | null = null,
      url: string | null = null,
      newsletter = NEWSLETTER,
      sendId: string | null = null,
    ) {
      await client.query(
        "INSERT INTO newsletter_event VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [newsletter, issueId, subscriberId, sendId, type, url, at],
      );
    }

    it("preserves confirmed history, ignores unconfirmed opt-outs and transient bounces, and carries the pre-range baseline through empty days", async () => {
      const manual = await subscriber(
        1,
        "MANUAL",
        "2026-09-30",
        null,
        null,
        null,
      );
      const pending = await subscriber(
        2,
        "SIGNUP_FORM",
        "2026-10-01",
        null,
        "2026-10-02",
        null,
      );
      const confirmed = await subscriber(
        3,
        "SIGNUP_FORM",
        "2026-10-01",
        "2026-10-03",
        null,
        null,
      );
      await subscriber(4, "CSV_IMPORT", "2026-10-01", null, null, "2026-10-02");
      await subscriber(
        5,
        "MANUAL",
        "2026-10-01",
        null,
        null,
        null,
        OTHER_NEWSLETTER,
      );
      await event(pending, "UNSUBSCRIBED", "2026-10-02");
      await event(confirmed, "CONFIRMED", "2026-10-01");
      await event(confirmed, "UNSUBSCRIBED", "2026-10-02");
      await event(confirmed, "CONFIRMED", "2026-10-03");
      await event(manual, "BOUNCED", "2026-10-02");
      const result = await getNewsletterAnalytics(SCOPE, RANGE);
      expect(result.subscriberGrowth).toEqual([
        {
          date: "2026-10-01",
          newActive: 2,
          unsubscribed: 0,
          bounced: 0,
          net: 2,
          runningTotal: 3,
        },
        {
          date: "2026-10-02",
          newActive: 0,
          unsubscribed: 1,
          bounced: 1,
          net: -2,
          runningTotal: 1,
        },
        {
          date: "2026-10-03",
          newActive: 1,
          unsubscribed: 0,
          bounced: 0,
          net: 1,
          runningTotal: 2,
        },
        {
          date: "2026-10-04",
          newActive: 0,
          unsubscribed: 0,
          bounced: 0,
          net: 0,
          runningTotal: 2,
        },
      ]);
    });

    it("counts manual and public unsubscribes once per person within the period and leaves issue attribution unknown", async () => {
      await subscriber(1, "MANUAL", "2026-09-30", null, "2026-10-02", null);
      const publicSubscriber = await subscriber(
        2,
        "SIGNUP_FORM",
        "2026-09-30",
        "2026-09-30",
        "2026-10-02",
        null,
      );
      await event(publicSubscriber, "UNSUBSCRIBED", "2026-10-02");
      await event(publicSubscriber, "UNSUBSCRIBED", "2026-10-03");
      const complaint = await subscriber(
        6,
        "MANUAL",
        "2026-09-30",
        null,
        null,
        null,
      );
      await event(complaint, "COMPLAINED", "2026-10-02");
      await event(complaint, "CONFIRMED", "2026-10-03");
      await subscriber(
        3,
        "MANUAL",
        "2026-09-01",
        null,
        "2026-09-30T23:59:59",
        null,
      );
      await subscriber(4, "MANUAL", "2026-09-01", null, "2026-10-05", null);
      await subscriber(
        5,
        "MANUAL",
        "2026-09-01",
        null,
        "2026-10-02",
        null,
        OTHER_NEWSLETTER,
      );
      await client.query(
        "INSERT INTO newsletter_issue VALUES ($1,$2,'Issue',$3,'SENT')",
        [ISSUE, NEWSLETTER, "2026-10-01"],
      );
      const result = await getNewsletterAnalytics(SCOPE, RANGE);
      expect(result.totals.unsubscribes).toBe(3);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.unsubscribes).toBeNull();
      expect(
        (await getNewsletterIssueAnalytics(SCOPE, ISSUE)).totals.unsubscribes,
      ).toBeNull();
    });

    it("deduplicates engagement and top links, excludes other issues and newsletters, and uses inclusive UTC dates", async () => {
      const first = await subscriber(
        1,
        "MANUAL",
        "2026-09-30",
        null,
        null,
        null,
      );
      const second = await subscriber(
        2,
        "MANUAL",
        "2026-09-30",
        null,
        null,
        null,
      );
      for (let duplicate = 0; duplicate < 2; duplicate++) {
        await event(
          first,
          "DELIVERED",
          "2026-10-01",
          ISSUE,
          null,
          NEWSLETTER,
          first,
        );
        await event(first, "OPENED", "2026-10-01", ISSUE);
        await event(
          first,
          "CLICKED",
          "2026-10-01",
          ISSUE,
          "https://example.com/a",
        );
      }
      await event(
        second,
        "DELIVERED",
        "2026-10-01",
        ISSUE,
        null,
        NEWSLETTER,
        second,
      );
      await event(
        second,
        "CLICKED",
        "2026-10-04T23:59:59",
        ISSUE,
        "https://example.com/a",
      );
      await event(
        first,
        "CLICKED",
        "2026-10-02",
        ISSUE,
        "https://example.com/b",
      );
      await event(
        null,
        "CLICKED",
        "2026-10-02",
        ISSUE,
        "https://example.com/a",
      );
      await event(
        first,
        "CLICKED",
        "2026-10-02",
        OTHER_ISSUE,
        "https://example.com/other",
      );
      await event(second, "OPENED", "2026-10-05", ISSUE);
      await event(second, "OPENED", "2026-09-30T23:59:59", ISSUE);
      await event(
        second,
        "OPENED",
        "2026-10-01",
        OTHER_ISSUE,
        null,
        OTHER_NEWSLETTER,
      );
      const result = await getNewsletterAnalytics(SCOPE, RANGE);
      expect(result.totals).toMatchObject({
        delivered: 2,
        uniqueOpens: 1,
        uniqueClicks: 2,
        openRate: 0.5,
        clickRate: 1,
      });
      expect(result.engagement.map((day) => day.uniqueOpens)).toEqual([
        1, 0, 0, 0,
      ]);
      expect(
        (await getNewsletterIssueAnalytics(SCOPE, ISSUE)).topLinks,
      ).toEqual([
        { url: "https://example.com/a", uniqueClicks: 2 },
        { url: "https://example.com/b", uniqueClicks: 1 },
      ]);
    });

    it("bounds issue pages, retains total counts, and uses stable sent-date/id cursors without duplicates", async () => {
      for (const id of [ISSUE, OTHER_ISSUE, OTHER_NEWSLETTER]) {
        await client.query(
          "INSERT INTO newsletter_issue VALUES ($1,$2,'Issue',$3,'SENT')",
          [id, NEWSLETTER, "2026-10-01"],
        );
      }
      const first = await getNewsletterAnalytics(SCOPE, { ...RANGE, limit: 2 });
      expect(first.issues.map((issue) => issue.id)).toEqual([
        OTHER_NEWSLETTER,
        OTHER_ISSUE,
      ]);
      expect(first.issuesPagination).toEqual({
        cursor: null,
        nextCursor: OTHER_ISSUE,
        total: 3,
        limit: 2,
      });
      const second = await getNewsletterAnalytics(SCOPE, {
        ...RANGE,
        limit: 2,
        cursor: OTHER_ISSUE,
      });
      expect(second.issues.map((issue) => issue.id)).toEqual([ISSUE]);
      expect(second.issuesPagination).toEqual({
        cursor: OTHER_ISSUE,
        nextCursor: null,
        total: 3,
        limit: 2,
      });
      expect(second.totals).toEqual(first.totals);
      const stale = await getNewsletterAnalytics(SCOPE, {
        ...RANGE,
        cursor: SCOPE.projectId,
      });
      expect(stale.issues).toEqual([]);
      expect(stale.issuesPagination).toMatchObject({
        cursor: SCOPE.projectId,
        total: 3,
        nextCursor: null,
      });
    });

    it("uses recorded manual activations after a public unsubscribe even when mutable timestamps or source have changed", async () => {
      const manual = await subscriber(
        1,
        "MANUAL",
        "2026-09-30",
        null,
        null,
        null,
      );
      const imported = await subscriber(
        2,
        "SIGNUP_FORM",
        "2026-09-30",
        "2026-10-03",
        null,
        null,
      );
      for (const id of [manual, imported]) {
        await event(id, "CONFIRMED", "2026-09-30");
        await event(id, "UNSUBSCRIBED", "2026-10-02");
        await event(id, "CONFIRMED", "2026-10-03");
      }
      const result = await getNewsletterAnalytics(SCOPE, RANGE);
      expect(result.subscriberGrowth.map((day) => day.runningTotal)).toEqual([
        2, 0, 2, 2,
      ]);
      expect(result.subscriberGrowth.map((day) => day.newActive)).toEqual([
        0, 0, 2, 0,
      ]);
      expect(result.totals.unsubscribes).toBe(2);
    });
  },
);
