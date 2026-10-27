import { PrismaRaw as Prisma } from "@sokosumi/database/client";

import { notFound, unprocessableEntity } from "@/helpers/error";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import prisma from "@/lib/db/prisma";
import type { NewsletterAnalyticsQuery } from "@/schemas/newsletter-analytics.schema";
import {
  getNewsletter,
  type NewsletterScope,
} from "@/services/newsletter.service";

const DAY_MS = 86_400_000;

export function newsletterAnalyticsRange(query: NewsletterAnalyticsQuery) {
  const to = query.to ?? new Date().toISOString().slice(0, 10);
  const end = new Date(`${to}T00:00:00Z`);
  const from =
    query.from ??
    new Date(end.getTime() - 29 * DAY_MS).toISOString().slice(0, 10);
  const start = new Date(`${from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  if (days < 1 || days > 366)
    throw unprocessableEntity("Choose a date range of 1 to 366 days");
  return { from, to, start, end };
}

interface EventCounts {
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  unsubscribes: number;
  bounces: number;
  complaints: number;
}

// DISTINCT ignores missing subscriber IDs and repeated webhook/open/click events.
const EVENT_COUNTS = Prisma.sql`
  COUNT(DISTINCT "sendId") FILTER (WHERE type = 'DELIVERED')::int AS delivered,
  COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'OPENED')::int AS "uniqueOpens",
  COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'CLICKED')::int AS "uniqueClicks",
  COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'UNSUBSCRIBED')::int AS unsubscribes,
  COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'BOUNCED')::int AS bounces,
  COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'COMPLAINED')::int AS complaints`;

function rates(
  counts: Pick<EventCounts, "delivered" | "uniqueOpens" | "uniqueClicks"> & {
    sent: number;
  },
) {
  const denominator = counts.delivered || counts.sent;
  return {
    openRate: denominator ? counts.uniqueOpens / denominator : 0,
    clickRate: denominator ? counts.uniqueClicks / denominator : 0,
  };
}

async function totals(
  newsletterId: string,
  range?: ReturnType<typeof newsletterAnalyticsRange>,
  issueId?: string,
) {
  const [sent, activeSubscribers, [events], [unsubscribes]] = await Promise.all(
    [
      prisma.newsletterSend.count({
        where: {
          issue: { newsletterId },
          issueId,
          status: "SENT",
          ...(range ? { sentAt: { gte: range.start, lt: range.end } } : {}),
        },
      }),
      prisma.newsletterSubscriber.count({
        where: { newsletterId, status: "ACTIVE" },
      }),
      prisma.$queryRaw<EventCounts[]>(Prisma.sql`
      SELECT ${EVENT_COUNTS} FROM newsletter_event
      WHERE "newsletterId" = ${newsletterId}::uuid
      ${issueId ? Prisma.sql`AND "issueId" = ${issueId}::uuid` : Prisma.empty}
      ${range ? Prisma.sql`AND "occurredAt" >= ${range.start} AND "occurredAt" < ${range.end}` : Prisma.empty}
    `),
      issueId
        ? Promise.resolve([{ count: null }])
        : prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT COUNT(DISTINCT "subscriberId")::int AS count FROM (
            SELECT "subscriberId", "occurredAt" AS at FROM newsletter_event
            WHERE "newsletterId" = ${newsletterId}::uuid AND type IN ('UNSUBSCRIBED', 'COMPLAINED')
            UNION ALL
            SELECT id, "unsubscribedAt" FROM newsletter_subscriber
            WHERE "newsletterId" = ${newsletterId}::uuid AND "unsubscribedAt" IS NOT NULL
          ) departures
          ${range ? Prisma.sql`WHERE at >= ${range.start} AND at < ${range.end}` : Prisma.empty}
        `),
    ],
  );
  const counts = {
    sent,
    ...(events ?? {
      delivered: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      unsubscribes: 0,
      bounces: 0,
      complaints: 0,
    }),
  };
  return {
    ...counts,
    ...rates(counts),
    activeSubscribers,
    unsubscribes: unsubscribes?.count ?? (issueId ? null : 0),
  };
}

interface IssueCounts extends EventCounts {
  id: string | null;
  subject: string;
  sentAt: Date | null;
  sent: number;
  total: number;
}

export async function getNewsletterAnalytics(
  scope: NewsletterScope,
  query: NewsletterAnalyticsQuery,
) {
  const range = newsletterAnalyticsRange(query);
  const { cursor, take } = parseCursorPagination(query);
  const newsletter = await getNewsletter(scope);
  const [summary, subscriberGrowth, engagement, issues] = await Promise.all([
    totals(newsletter.id, range),
    prisma.$queryRaw<
      Array<{
        date: string;
        newActive: number;
        unsubscribed: number;
        bounced: number;
        net: number;
        runningTotal: number;
      }>
    >(Prisma.sql`
      WITH subscribers AS (
        SELECT id, "createdAt", "confirmedAt", "unsubscribedAt", "bouncedAt", source, status
        FROM newsletter_subscriber WHERE "newsletterId" = ${newsletter.id}::uuid
      ), transitions AS (
        SELECT id, "createdAt" AS at, 1 AS active, 0 AS unsubscribed, 0 AS bounced
        FROM subscribers WHERE source <> 'SIGNUP_FORM' AND status <> 'PENDING'
        UNION
        SELECT id, "confirmedAt", 1, 0, 0 FROM subscribers WHERE "confirmedAt" IS NOT NULL
        UNION
        SELECT e."subscriberId", e."occurredAt",
          CASE WHEN e.type = 'CONFIRMED' THEN 1 ELSE 0 END,
          CASE WHEN e.type = 'CONFIRMED' THEN 0 ELSE 1 END, 0
        FROM newsletter_event e JOIN subscribers s ON s.id = e."subscriberId"
        WHERE e."newsletterId" = ${newsletter.id}::uuid
          AND e.type IN ('CONFIRMED', 'UNSUBSCRIBED', 'COMPLAINED')
        UNION
        SELECT id, "unsubscribedAt", 0, 1, 0 FROM subscribers WHERE "unsubscribedAt" IS NOT NULL
        UNION
        SELECT id, "bouncedAt", 0, 0, 1 FROM subscribers WHERE "bouncedAt" IS NOT NULL
      ), deltas AS (
        SELECT *, active - LAG(active, 1, 0) OVER (
          PARTITION BY id ORDER BY at, active DESC, unsubscribed DESC
        ) AS delta FROM transitions
      ), changes AS (
        SELECT at, GREATEST(delta, 0) AS added,
          CASE WHEN delta < 0 THEN unsubscribed ELSE 0 END AS unsubscribed,
          CASE WHEN delta < 0 THEN bounced ELSE 0 END AS bounced
        FROM deltas
      ), daily AS (
        SELECT at::date AS day,
          SUM(added)::int AS added, SUM(unsubscribed)::int AS unsubscribed, SUM(bounced)::int AS bounced
        FROM changes WHERE at < ${range.end} GROUP BY 1
      ), days AS (
        SELECT generate_series(${range.start}::timestamp, ${range.end}::timestamp - interval '1 day', interval '1 day')::date AS day
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
        COALESCE(daily.added, 0)::int AS "newActive",
        COALESCE(daily.unsubscribed, 0)::int AS unsubscribed,
        COALESCE(daily.bounced, 0)::int AS bounced,
        (COALESCE(daily.added, 0) - COALESCE(daily.unsubscribed, 0) - COALESCE(daily.bounced, 0))::int AS net,
        ((SELECT COALESCE(SUM(added - unsubscribed - bounced), 0) FROM daily WHERE day < ${range.start}::date)
          + SUM(COALESCE(daily.added, 0) - COALESCE(daily.unsubscribed, 0) - COALESCE(daily.bounced, 0)) OVER (ORDER BY days.day))::int AS "runningTotal"
      FROM days LEFT JOIN daily USING (day) ORDER BY days.day
    `),
    prisma.$queryRaw<
      Array<{ date: string; uniqueOpens: number; uniqueClicks: number }>
    >(Prisma.sql`
      WITH days AS (
        SELECT generate_series(${range.start}::timestamp, ${range.end}::timestamp - interval '1 day', interval '1 day')::date AS day
      ), daily AS (
        SELECT "occurredAt"::date AS day,
          COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'OPENED')::int AS "uniqueOpens",
          COUNT(DISTINCT "subscriberId") FILTER (WHERE type = 'CLICKED')::int AS "uniqueClicks"
        FROM newsletter_event WHERE "newsletterId" = ${newsletter.id}::uuid
          AND "occurredAt" >= ${range.start} AND "occurredAt" < ${range.end}
          AND type IN ('OPENED', 'CLICKED') GROUP BY 1
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
        COALESCE(daily."uniqueOpens", 0)::int AS "uniqueOpens", COALESCE(daily."uniqueClicks", 0)::int AS "uniqueClicks"
      FROM days LEFT JOIN daily USING (day) ORDER BY days.day
    `),
    prisma.$queryRaw<IssueCounts[]>(Prisma.sql`
      WITH sends AS (
        SELECT s."issueId", COUNT(*)::int AS sent FROM newsletter_send s
        JOIN newsletter_issue i ON i.id = s."issueId"
        WHERE i."newsletterId" = ${newsletter.id}::uuid AND s.status = 'SENT'
          AND s."sentAt" >= ${range.start} AND s."sentAt" < ${range.end} GROUP BY s."issueId"
      ), events AS (
        SELECT "issueId", ${EVENT_COUNTS} FROM newsletter_event
        WHERE "newsletterId" = ${newsletter.id}::uuid
          AND "occurredAt" >= ${range.start} AND "occurredAt" < ${range.end}
          AND type IN ('DELIVERED', 'OPENED', 'CLICKED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED')
        GROUP BY "issueId"
      ), matching AS (
      SELECT i.id, i.subject, i."sentAt", COALESCE(s.sent, 0)::int AS sent,
        COALESCE(e.delivered, 0)::int AS delivered, COALESCE(e."uniqueOpens", 0)::int AS "uniqueOpens",
        COALESCE(e."uniqueClicks", 0)::int AS "uniqueClicks", COALESCE(e.unsubscribes, 0)::int AS unsubscribes,
        COALESCE(e.bounces, 0)::int AS bounces, COALESCE(e.complaints, 0)::int AS complaints
      FROM newsletter_issue i LEFT JOIN sends s ON s."issueId" = i.id LEFT JOIN events e ON e."issueId" = i.id
      WHERE i."newsletterId" = ${newsletter.id}::uuid AND
        (s."issueId" IS NOT NULL OR e."issueId" IS NOT NULL OR (i.status = 'SENT' AND i."sentAt" >= ${range.start} AND i."sentAt" < ${range.end}))
      )
      SELECT page.*, counts.total
      FROM (SELECT COUNT(*)::int AS total FROM matching) counts
      LEFT JOIN LATERAL (
      SELECT * FROM matching
      ${
        cursor
          ? Prisma.sql`WHERE (COALESCE("sentAt", '-infinity'::timestamp), id) < (
        SELECT COALESCE("sentAt", '-infinity'::timestamp), id FROM newsletter_issue
        WHERE id = ${cursor}::uuid AND "newsletterId" = ${newsletter.id}::uuid
      )`
          : Prisma.empty
      }
      ORDER BY "sentAt" DESC NULLS LAST, id DESC LIMIT ${take + 1}
      ) page ON TRUE
      ORDER BY page."sentAt" DESC NULLS LAST, page.id DESC
    `),
  ]);
  const rows = issues.filter(
    (issue): issue is IssueCounts & { id: string } => issue.id !== null,
  );
  const page = rows.slice(0, take);
  return {
    from: range.from,
    to: range.to,
    totals: summary,
    subscriberGrowth,
    engagement,
    // Unsubscribe links identify a newsletter/subscriber, never an issue.
    issues: page.map(({ total: _total, ...issue }) => ({
      ...issue,
      ...rates(issue),
      unsubscribes: null,
    })),
    issuesPagination: createPaginationMeta(
      page,
      issues[0]?.total ?? 0,
      take,
      rows.length > take,
      cursor,
    ),
  };
}

export async function getNewsletterIssueAnalytics(
  scope: NewsletterScope,
  issueId: string,
) {
  const newsletter = await getNewsletter(scope);
  const issue = await prisma.newsletterIssue.findUnique({
    where: { ...scope, newsletterId: newsletter.id, id: issueId },
    select: { id: true },
  });
  if (!issue) throw notFound("Newsletter issue not found");
  const [summary, topLinks] = await Promise.all([
    totals(newsletter.id, undefined, issueId),
    prisma.$queryRaw<Array<{ url: string; uniqueClicks: number }>>(Prisma.sql`
      SELECT url, COUNT(DISTINCT "subscriberId")::int AS "uniqueClicks"
      FROM newsletter_event WHERE "newsletterId" = ${newsletter.id}::uuid
        AND "issueId" = ${issueId}::uuid AND type = 'CLICKED' AND url IS NOT NULL AND "subscriberId" IS NOT NULL
      GROUP BY url ORDER BY "uniqueClicks" DESC, url ASC LIMIT 20
    `),
  ]);
  return { totals: summary, topLinks };
}
