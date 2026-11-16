import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { conflict, forbidden, notFound } from "@/helpers/error";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import { serializableTransaction } from "@/lib/db/transaction";
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
import {
  requireLockedSeoOwner,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { resolveSeoStatisticsIntegration } from "./seo-connections.service";

const approvedRequestSchema = z
  .object({
    pageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
  })
  .refine((input) => new Set(input.pageUrls).size === input.pageUrls.length);

/** Caller assertions only narrow an assigned Task. They never choose a Google account or a URL. */
export async function requireSeoTaskIndexingContext(
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

  // These no-op writes serialize disconnect/replacement and inherited account revocation with the final save.
  await tx.$executeRaw`
    UPDATE "seo_connection" SET "updatedAt" = "updatedAt"
    WHERE "workspaceId" = ${actor.workspaceId}::uuid AND "userId" = ${actor.userId} AND provider = 'search_console'
  `;
  let integration = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
    tx,
  );
  if (integration?.connectionRevision.startsWith("personal:")) {
    await tx.$executeRaw`
      UPDATE "soko_bot_integration" SET "updatedAt" = "updatedAt"
      WHERE "composioAccountId" = ${integration.composioAccountId}
    `;
    await tx.$executeRaw`
      UPDATE "soko_bot" SET "updatedAt" = "updatedAt" WHERE id IN (
        SELECT "sokoBotId" FROM "soko_bot_integration" WHERE "composioAccountId" = ${integration.composioAccountId}
      )
    `;
    integration = await resolveSeoStatisticsIntegration(
      actor,
      "search_console",
      tx,
    );
  }
  const latest = await tx.projectSeoObservation.findFirst({
    where: {
      ...seoOwnerWhere(actor),
      ownerId: actor.userId,
      kind: "metrics",
      source: "search_console",
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const selection = z
    .object({ propertyId: z.string().min(1).max(500) })
    .safeParse(latest?.payload);
  const selectedProperty = selection.success ? selection.data.propertyId : null;
  const contextFingerprint = sha256(
    JSON.stringify({
      taskId,
      expected,
      analysisId: analysis.id,
      requestHash: analysis.requestHash,
      request: analysis.request,
      pageIds: analysis.pageIds,
      pageUrls,
      selectedProperty,
      integration: integration
        ? [
            integration.composioAccountId,
            integration.entityId,
            integration.connectionRevision,
          ]
        : null,
    }),
  );
  return {
    actor,
    taskId,
    analysis,
    pageUrls,
    integration,
    selectedProperty,
    contextFingerprint,
  };
}

export type SeoTaskIndexingContext = Awaited<
  ReturnType<typeof requireSeoTaskIndexingContext>
>;

export function readSeoTaskIndexingContext(
  auth: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
) {
  return serializableTransaction(
    (tx) => requireSeoTaskIndexingContext(auth, taskId, expected, tx),
    "The audit or Google connection changed. Please retry.",
  );
}

export function assertSameSeoTaskIndexingContext(
  before: SeoTaskIndexingContext,
  after: SeoTaskIndexingContext,
) {
  if (before.contextFingerprint !== after.contextFingerprint)
    throw conflict("The audit or Google connection changed during inspection");
}
