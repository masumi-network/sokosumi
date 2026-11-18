import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { seoVisibilityFor } from "@/lib/seo/data-visibility";
import { googleReturnedUnknown } from "@/lib/seo/inspection-provenance";
import { unavailableGscTaskInspection } from "@/lib/seo/native-gsc-task-inspection";
import {
  type SeoActor,
  seoIndexedPageSchema,
} from "@/schemas/project-seo.schema";
import type {
  SeoBriefContent,
  SeoBriefFollowUp,
} from "@/schemas/seo-audit-brief.schema";
import {
  seoAnsweredUnknownPageUrlsSchema,
  seoReusedInspectionTimesSchema,
  seoTaskIndexedPageSchema,
} from "@/schemas/seo-task-indexing.schema";
import { seoOwnerWhere } from "./project-seo-store";

const indexing = seoIndexedPageSchema
  .pick({
    pageUrl: true,
    verdict: true,
    lastCrawlTime: true,
    indexingState: true,
  })
  .strip();
type ObservedIndex = z.infer<typeof indexing>;
const metricSnapshot = z.object({
  indexedPages: z.array(indexing),
  collectedAt: z.iso.datetime().optional(),
});
const taskInspection = z.object({
  propertyId: z.string().nullable().optional(),
  providerAnsweredAll: z.literal(true).optional(),
  answeredUnknownPageUrls: seoAnsweredUnknownPageUrlsSchema.optional(),
  reusedCheckedAt: seoReusedInspectionTimesSchema.optional(),
  receipt: z.object({
    checkedAt: z.iso.datetime(),
    pages: z.array(
      seoTaskIndexedPageSchema
        .partial()
        .required({ pageUrl: true, verdict: true, lastCrawlTime: true })
        .strip(),
    ),
  }),
});
const INSPECTION_HISTORY_BATCH_SIZE = 16;
const newestObservationFirst = [
  { observedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.ProjectSeoObservationOrderByWithRelationInput[];

interface InspectionObservation {
  payload: Prisma.JsonValue;
  observedAt: Date;
}

function metricPageInspection(
  { payload, observedAt }: InspectionObservation,
  url: string,
) {
  const snapshot = metricSnapshot.safeParse(payload);
  if (!snapshot.success) return null;
  const page = snapshot.data.indexedPages.find((item) => item.pageUrl === url);
  if (!page) return null;
  return {
    page,
    checkedAt: snapshot.data.collectedAt
      ? Date.parse(snapshot.data.collectedAt)
      : observedAt.getTime(),
  };
}

function taskPageInspection({ payload }: InspectionObservation, url: string) {
  const task = taskInspection.safeParse(payload);
  if (!task.success) return null;
  const page = task.data.receipt.pages.find((item) => item.pageUrl === url);
  if (!page) return null;
  if (
    page.verdict === "VERDICT_UNSPECIFIED" &&
    !googleReturnedUnknown(task.data, page)
  )
    return null;
  return {
    page,
    checkedAt: Date.parse(
      task.data.reusedCheckedAt?.[url] ?? task.data.receipt.checkedAt,
    ),
  };
}

async function latestPageInspection(
  where: Prisma.ProjectSeoObservationWhereInput,
  url: string,
  client: Prisma.TransactionClient,
  read: typeof taskPageInspection,
) {
  const select = { id: true, payload: true, observedAt: true };
  const newest = await client.projectSeoObservation.findFirst({
    where,
    orderBy: newestObservationFirst,
    select,
  });
  if (!newest) return null;
  let latest = read(newest, url);
  let cursor = newest;
  // Cache activation moves a row forward. Stop once older rows cannot have a newer Google read.
  while (!latest || latest.checkedAt < cursor.observedAt.getTime()) {
    const rows = await client.projectSeoObservation.findMany({
      where: latest
        ? { ...where, observedAt: { gt: new Date(latest.checkedAt) } }
        : where,
      cursor: { id: cursor.id },
      skip: 1,
      take: INSPECTION_HISTORY_BATCH_SIZE,
      orderBy: newestObservationFirst,
      select,
    });
    for (const row of rows) {
      if (latest && row.observedAt.getTime() <= latest.checkedAt) return latest;
      const inspection = read(row, url);
      if (inspection && (!latest || inspection.checkedAt > latest.checkedAt))
        latest = inspection;
    }
    if (rows.length < INSPECTION_HISTORY_BATCH_SIZE) break;
    cursor = rows[rows.length - 1]!;
  }
  return latest;
}

export function briefFollowUp(
  page: Pick<SeoBriefContent["pages"][number], "pageId" | "indexIntent">,
  changedAt: Date | null,
  inspection: ObservedIndex | null,
): SeoBriefFollowUp {
  const crawl = inspection?.lastCrawlTime
    ? new Date(inspection.lastCrawlTime)
    : null;
  const status =
    !changedAt || !crawl
      ? "unknown"
      : crawl > changedAt
        ? "recrawled"
        : "awaiting_recrawl";
  let indexReview: SeoBriefFollowUp["indexReview"] = "unknown";
  if (inspection && (!changedAt || status === "recrawled")) {
    if (page.indexIntent === "exclude") {
      if (inspection.verdict === "PASS") indexReview = "review_exclusion";
      else if (
        inspection.indexingState === "BLOCKED_BY_META_TAG" ||
        inspection.indexingState === "BLOCKED_BY_HTTP_HEADER"
      )
        indexReview = "expected_exclusion";
    } else if (page.indexIntent === "index") {
      if (inspection.verdict === "PASS") indexReview = "matches_intent";
      else if (
        inspection.verdict === "FAIL" ||
        inspection.verdict === "NEUTRAL"
      )
        indexReview = "review_indexing";
    }
  }
  return {
    pageId: page.pageId,
    changedAt: changedAt?.toISOString() ?? null,
    lastCrawlAt: crawl?.toISOString() ?? null,
    status,
    indexReview,
  };
}

export async function loadBriefFollowUps(
  actor: SeoActor,
  content: SeoBriefContent,
  pages: { id: string; url: string }[],
  client: Prisma.TransactionClient,
) {
  const urls = new Map(pages.map((p) => [p.id, p.url]));
  const owner = seoOwnerWhere(actor);
  return Promise.all(
    content.pages.map(async (page) => {
      const url = urls.get(page.pageId);
      if (!url) return briefFollowUp(page, null, null);
      const [change, metrics, inspection] = await Promise.all([
        client.projectSeoObservation.findFirst({
          where: {
            ...owner,
            kind: "page_change",
            source: "user",
            ownerId: null,
            pageIds: { has: page.pageId },
          },
          orderBy: newestObservationFirst,
          select: { observedAt: true },
        }),
        latestPageInspection(
          {
            ...owner,
            kind: "metrics",
            source: "search_console",
            pageIds: { has: page.pageId },
            visibility: seoVisibilityFor(actor),
            ownerId: actor.organizationId ? { not: null } : actor.userId,
            payload: {
              path: ["indexedPages"],
              array_contains: [{ pageUrl: url }],
            },
          },
          url,
          client,
          metricPageInspection,
        ),
        latestPageInspection(
          {
            ...owner,
            kind: "index_inspection",
            source: "search_console",
            ownerId: actor.userId,
            visibility: "PRIVATE",
            payload: {
              path: ["receipt", "pages"],
              array_contains: [{ pageUrl: url }],
            },
            OR: [
              {
                NOT: {
                  payload: {
                    path: ["receipt", "pages"],
                    array_contains: [unavailableGscTaskInspection(url)],
                  },
                },
              },
              { payload: { path: ["providerAnsweredAll"], equals: true } },
              {
                payload: {
                  path: ["answeredUnknownPageUrls"],
                  array_contains: [url],
                },
              },
            ],
          },
          url,
          client,
          taskPageInspection,
        ),
      ]);
      const changedAt = change?.observedAt ?? null;
      const inspected = inspection?.page;
      if (!metrics) return briefFollowUp(page, changedAt, inspected ?? null);
      const synced = metrics.page;
      if (inspection && inspection.checkedAt > metrics.checkedAt)
        return briefFollowUp(page, changedAt, inspection.page);

      // Older statistics snapshots omitted the state. Only the same Google crawl and verdict can supply it.
      if (
        synced.indexingState === undefined &&
        inspected?.indexingState &&
        synced.verdict === inspected.verdict &&
        synced.lastCrawlTime &&
        inspected.lastCrawlTime &&
        Date.parse(synced.lastCrawlTime) === Date.parse(inspected.lastCrawlTime)
      ) {
        return briefFollowUp(page, changedAt, {
          ...synced,
          indexingState: inspected.indexingState,
        });
      }
      return briefFollowUp(page, changedAt, synced);
    }),
  );
}
