import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { canonicalJsonKey } from "@sokosumi/masumi/schemas";
import { conflict, forbidden, notFound } from "@/helpers/error";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import { originalSeoAuditPacket } from "@/lib/seo/related-page-selection";
import {
  type AuthenticationContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import {
  SEO_MAX_PAGES,
  type SeoActor,
  seoUrlSchema,
} from "@/schemas/project-seo.schema";
import type { TaskWorkerContext } from "@/schemas/task-worker-context.schema";
import { requireLockedSeoOwner, seoOwnerWhere } from "./project-seo-store";

const approvedRequestSchema = z
  .object({
    pageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
  })
  .refine((input) => new Set(input.pageUrls).size === input.pageUrls.length);

/** Lock and recheck the assigned worker, owner, audit and exact frozen pages before a Task-bound operation. */
export async function requireSeoTaskAuditContext(
  auth: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
  tx: Prisma.TransactionClient,
) {
  const coworker = requireCoworkerAuthContext(auth);
  if (coworker.context)
    throw forbidden("Use the assigned Coworker's standalone Task key");
  const task = await requireTaskWorkerContext(auth, taskId, expected, tx);
  if (!["RUNNING", "COMPLETED"].includes(task.status))
    throw conflict("Indexing checks require a running or completed audit Task");
  await tx.$executeRaw`
    UPDATE "project_seo_analysis" SET "updatedAt" = "updatedAt" WHERE "taskId" = ${taskId}
  `;
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId },
  });
  if (
    !analysis ||
    analysis.kind !== "audit_full" ||
    analysis.requestedBy !== task.ownerId ||
    (analysis.auditId === null) === (analysis.projectId === null)
  )
    throw notFound("This Task has no approved full SEO audit");
  const actor: SeoActor = {
    userId: expected.ownerId,
    organizationId: expected.organizationId,
    workspaceId: expected.workspaceId,
    owner: analysis.auditId
      ? { kind: "audit", id: analysis.auditId }
      : { kind: "project", id: analysis.projectId! },
  };
  await requireLockedSeoOwner(tx, actor, false);
  const parsed = approvedRequestSchema.safeParse(analysis.request);
  if (!parsed.success)
    throw conflict("The approved SEO page scope is unavailable");
  const pageUrls = parsed.data.pageUrls;
  const pages = await tx.projectSeoPage.findMany({
    where: { ...seoOwnerWhere(actor), id: { in: analysis.pageIds } },
    select: { id: true, url: true },
  });
  if (
    pages.length !== pageUrls.length ||
    analysis.pageIds.length !== pageUrls.length ||
    pages.some((page) => !pageUrls.includes(page.url))
  )
    throw conflict("The approved SEO pages changed");

  if (
    z.object({ discoverRelated: z.literal(true) }).safeParse(analysis.request)
      .success
  ) {
    let currentPacket: unknown;
    try {
      if (!task.description?.startsWith("seo_audit:"))
        throw new Error("Missing packet");
      currentPacket = JSON.parse(task.description.slice("seo_audit:".length));
    } catch {
      throw conflict("The approved audit Task request changed");
    }
    if (
      canonicalJsonKey(currentPacket) !==
      canonicalJsonKey(originalSeoAuditPacket(analysis.request))
    )
      throw conflict("The approved audit Task request changed");
  }
  return { actor, task, taskId, analysis, pageUrls };
}
