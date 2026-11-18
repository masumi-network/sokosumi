import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { seoVisibilityFor } from "@/lib/seo/data-visibility";
import {
  type SeoActor,
  seoIndexedPageSchema,
} from "@/schemas/project-seo.schema";
import type {
  SeoBriefContent,
  SeoBriefFollowUp,
} from "@/schemas/seo-audit-brief.schema";
import { seoReusedInspectionTimesSchema } from "@/schemas/seo-task-indexing.schema";
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
  reusedCheckedAt: seoReusedInspectionTimesSchema.optional(),
  receipt: z.object({ checkedAt: z.iso.datetime(), pages: z.array(indexing) }),
});
const newestObservationFirst = [
  { observedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.ProjectSeoObservationOrderByWithRelationInput[];

function taskPageInspection(payload: unknown, url: string) {
  const task = taskInspection.safeParse(payload);
  if (!task.success) return null;
  const page = task.data.receipt.pages.find((item) => item.pageUrl === url);
  if (!page) return null;
  return {
    page,
    checkedAt: Date.parse(
      task.data.reusedCheckedAt?.[url] ?? task.data.receipt.checkedAt,
    ),
  };
}

async function latestTaskPageInspection(
  actor: SeoActor,
  url: string,
  client: Prisma.TransactionClient,
) {
  const where = {
    ...seoOwnerWhere(actor),
    kind: "index_inspection",
    source: "search_console",
    ownerId: actor.userId,
    visibility: "PRIVATE",
    payload: {
      path: ["receipt", "pages"],
      array_contains: [{ pageUrl: url }],
    },
  } satisfies Prisma.ProjectSeoObservationWhereInput;
  const newest = await client.projectSeoObservation.findFirst({
    where,
    orderBy: newestObservationFirst,
    select: { id: true, payload: true, observedAt: true },
  });
  if (!newest) return null;
  let latest = taskPageInspection(newest.payload, url);
  if (!latest || latest.checkedAt >= newest.observedAt.getTime()) return latest;

  // A retry can reuse an older page. Another task may have checked it in between.
  const intervening = await client.projectSeoObservation.findMany({
    where: {
      ...where,
      id: { not: newest.id },
      observedAt: { gt: new Date(latest.checkedAt) },
    },
    orderBy: newestObservationFirst,
    select: { payload: true },
  });
  for (const row of intervening) {
    const inspection = taskPageInspection(row.payload, url);
    if (inspection && inspection.checkedAt > latest.checkedAt)
      latest = inspection;
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
      const select = { payload: true, observedAt: true };
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
        client.projectSeoObservation.findFirst({
          where: {
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
          orderBy: newestObservationFirst,
          select,
        }),
        latestTaskPageInspection(actor, url, client),
      ]);
      const native = metricSnapshot.safeParse(metrics?.payload);
      const changedAt = change?.observedAt ?? null;
      const inspected = inspection?.page;
      const synced = native.success
        ? native.data.indexedPages.find((item) => item.pageUrl === url)
        : undefined;
      if (!native.success || !synced || !metrics)
        return briefFollowUp(page, changedAt, inspected ?? null);
      const syncedAt = native.data.collectedAt
        ? Date.parse(native.data.collectedAt)
        : metrics.observedAt.getTime();
      if (inspection && inspection.checkedAt > syncedAt)
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
