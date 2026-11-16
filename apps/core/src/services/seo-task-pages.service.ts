import type { Prisma } from "@sokosumi/database";
import { SEO_FULL_AUDIT_CREDITS } from "@sokosumi/utils";
import { z } from "zod";

import { badRequest, conflict } from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  originalSeoAuditPacket,
  selectSeoRelatedPages,
} from "@/lib/seo/related-page-selection";
import type { AuthenticationContext } from "@/middleware/auth";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  SEO_MAX_PACKET_CHARS,
  type SeoTaskPagesRequest,
  seoPageSelectionSchema,
} from "@/schemas/seo-task-pages.schema";
import {
  seoOwnerData,
  seoOwnerUnique,
  seoOwnerWhere,
} from "./project-seo-store";
import { requireSeoTaskAuditContext } from "./seo-task-audit-context";

/** Bound malformed relationship chains, then use an owned same-host root without rewriting existing pages. */
const MAX_PARENT_LOOKUPS = 10;
async function discoveryParent(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  seed: {
    id: string;
    url: string;
    relationship: string;
    relatedToPageId: string | null;
  },
) {
  let page = seed;
  const visited = new Set<string>();
  for (let depth = 0; depth < MAX_PARENT_LOOKUPS; depth++) {
    if (page.relationship === "primary") return page.id;
    if (!page.relatedToPageId || visited.has(page.id)) break;
    visited.add(page.id);
    const parent = await tx.projectSeoPage.findFirst({
      where: { ...seoOwnerWhere(actor), id: page.relatedToPageId },
    });
    if (!parent) break;
    page = parent;
  }
  const host = new URL(seed.url).host;
  const root = await tx.projectSeoPage.findFirst({
    where: {
      ...seoOwnerWhere(actor),
      relationship: "primary",
      OR: ["http:", "https:"].map((protocol) => ({
        url: { startsWith: `${protocol}//${host}/` },
      })),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return root?.id ?? seed.id;
}

const discoveryRequest = z.object({
  discoverRelated: z.literal(true),
  price: z.strictObject({
    kind: z.literal("fixed"),
    credits: z.literal(SEO_FULL_AUDIT_CREDITS),
  }),
  pageUrls: z.array(z.string()),
});

/** One immutable page selection per approved Task. Concurrent discovery and Task edits serialize on the same rows. */
export function selectSeoTaskPages(
  auth: AuthenticationContext,
  taskId: string,
  input: SeoTaskPagesRequest,
) {
  return serializableTransaction(async (tx) => {
    const { actor, analysis, task, pageUrls } =
      await requireSeoTaskAuditContext(auth, taskId, input.expectedContext, tx);
    if (task.status !== "RUNNING")
      throw conflict("Page discovery requires a running audit Task");
    const original = originalSeoAuditPacket(analysis.request);
    const packet = discoveryRequest.safeParse(original);
    if (!packet.success)
      throw conflict("This audit did not approve related-page discovery");
    if (
      JSON.stringify(input.seedPageUrls) !==
      JSON.stringify(packet.data.pageUrls)
    )
      throw conflict("The approved audit seed pages or Task request changed");
    const stored = z
      .object({ relatedPageSelection: seoPageSelectionSchema })
      .safeParse(analysis.request);
    if (stored.success) return { version: 1 as const, taskId, pageUrls };
    const selected = selectSeoRelatedPages(
      input.seedPageUrls,
      input.relatedPageUrls,
    );
    if (
      JSON.stringify({ ...original, pageUrls: selected }).length >
      SEO_MAX_PACKET_CHARS
    )
      throw badRequest(
        "The selected audit pages exceed the worker packet limit",
      );
    if (
      await tx.projectSeoObservation.count({ where: { sourceTaskId: taskId } })
    )
      throw conflict(
        "An audit with saved evidence cannot change its page scope",
      );
    const seed = await tx.projectSeoPage.findFirst({
      where: { ...seoOwnerWhere(actor), url: input.seedPageUrls[0] },
      select: {
        id: true,
        url: true,
        relationship: true,
        relatedToPageId: true,
      },
    });
    if (!seed) throw conflict("The audit's primary context changed");
    // A full audit may start on an existing related page. New discoveries still belong to its Audit root.
    const parentId =
      selected.length > input.seedPageUrls.length
        ? await discoveryParent(tx, actor, seed)
        : seed.id;
    const pageIds: string[] = [];
    for (const url of selected) {
      const page = await tx.projectSeoPage.upsert({
        where: seoOwnerUnique(actor, "url", { url }),
        create: {
          ...seoOwnerData(actor),
          url,
          relationship: pageIds.length ? "related" : "primary",
          relatedToPageId: pageIds.length ? parentId : null,
        },
        update: {},
      });
      pageIds.push(page.id);
    }
    const selection = {
      version: 1 as const,
      seedPageUrls: packet.data.pageUrls,
      pageUrls: selected,
    };
    await tx.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        pageIds,
        request: {
          ...original,
          pageUrls: selected,
          relatedPageSelection: selection,
        },
      },
    });
    return { version: 1 as const, taskId, pageUrls: selected };
  }, "The audit page selection changed. Please retry.");
}
