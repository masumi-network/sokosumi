import type { Prisma } from "@sokosumi/database";

import { seoPageComparisonKey } from "@/lib/seo/related-page-selection";
import { SEO_MAX_PAGES, type SeoActor } from "@/schemas/project-seo.schema";
import { resolveSeoScope, seoOwnerWhere } from "./project-seo-store";

type SeoScope = Awaited<ReturnType<typeof resolveSeoScope>>;

/** Selecting an Audit's primary page includes its saved same-host children. Explicit groups and child selections remain exact. */
export async function withSavedAuditRelatedPages(
  actor: SeoActor,
  scope: SeoScope,
  tx: Prisma.TransactionClient,
): Promise<SeoScope> {
  const primary = scope.pages[0];
  if (
    actor.owner.kind !== "audit" ||
    scope.id ||
    scope.pages.length !== 1 ||
    primary?.relationship !== "primary"
  )
    return scope;
  const host = new URL(primary.url).host;
  const latest = await tx.projectSeoAnalysis.findFirst({
    where: { ...seoOwnerWhere(actor), kind: "audit_full" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { pageIds: true },
  });
  const priority = new Map(
    (latest?.pageIds ?? []).map((id, index) => [id, index]),
  );
  const related = await tx.projectSeoPage.findMany({
    where: {
      ...seoOwnerWhere(actor),
      relationship: "related",
      relatedToPageId: primary.id,
      OR: ["http:", "https:"].map((protocol) => ({
        url: { startsWith: `${protocol}//${host}/` },
      })),
    },
    // The newest audit selection comes first; saved page order breaks ties.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  related.sort(
    (a, b) =>
      (priority.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (priority.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const seen = new Set([seoPageComparisonKey(primary.url)]);
  const pages = [
    primary,
    ...related
      .filter((page) => {
        const key = seoPageComparisonKey(page.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, SEO_MAX_PAGES - 1),
  ];
  return { ...scope, pages, pageIds: pages.map((page) => page.id) };
}
