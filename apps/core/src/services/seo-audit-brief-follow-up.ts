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
import { seoOwnerWhere } from "./project-seo-store";

const indexing = seoIndexedPageSchema
  .pick({ pageUrl: true, verdict: true, lastCrawlTime: true })
  .extend({ indexingState: z.string().nullable().optional() })
  .strip();
type ObservedIndex = z.infer<typeof indexing>;
const metricSnapshot = z.object({
  indexedPages: z.array(indexing),
  collectedAt: z.iso.datetime().optional(),
});
const taskInspection = z.object({
  receipt: z.object({ checkedAt: z.iso.datetime(), pages: z.array(indexing) }),
});

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
      const orderBy = [
        { observedAt: "desc" as const },
        { createdAt: "desc" as const },
        { id: "desc" as const },
      ];
      const [change, metrics, inspection] = await Promise.all([
        client.projectSeoObservation.findFirst({
          where: {
            ...owner,
            kind: "page_change",
            source: "user",
            ownerId: null,
            pageIds: { has: page.pageId },
          },
          orderBy,
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
          orderBy,
          select,
        }),
        client.projectSeoObservation.findFirst({
          where: {
            ...owner,
            kind: "index_inspection",
            source: "search_console",
            ownerId: actor.userId,
            visibility: "PRIVATE",
            payload: {
              path: ["receipt", "pages"],
              array_contains: [{ pageUrl: url }],
            },
          },
          orderBy,
          select,
        }),
      ]);
      const native = metricSnapshot.safeParse(metrics?.payload);
      const task = taskInspection.safeParse(inspection?.payload);
      const candidates = [
        ...(native.success && metrics
          ? [
              {
                at: Date.parse(
                  native.data.collectedAt ?? metrics.observedAt.toISOString(),
                ),
                pages: native.data.indexedPages,
              },
            ]
          : []),
        ...(task.success
          ? [
              {
                at: Date.parse(task.data.receipt.checkedAt),
                pages: task.data.receipt.pages,
              },
            ]
          : []),
      ];
      const latest = candidates
        .sort((a, b) => b.at - a.at)[0]
        ?.pages.find((item) => item.pageUrl === url);
      return briefFollowUp(page, change?.observedAt ?? null, latest ?? null);
    }),
  );
}
