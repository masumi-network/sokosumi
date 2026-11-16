import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { conflict, unprocessableEntity } from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import type { AuthenticationContext } from "@/middleware/auth";
import type { TaskWorkerContext } from "@/schemas/task-worker-context.schema";
import { seoOwnerWhere, sha256 } from "./project-seo-store";
import { seoAuditInspectionPages } from "./seo-audit-related-pages";
import { resolveSeoStatisticsIntegration } from "./seo-connections.service";
import { requireSeoTaskAuditContext } from "./seo-task-audit-context";

/** The worker may attach evidence only to an originally approved full-audit seed. */
export function resolveSeoIndexingAuditPageUrl(
  pageUrls: string[],
  hint?: string,
): string {
  const selected = hint ?? pageUrls[0];
  if (!selected || !pageUrls.includes(selected))
    throw unprocessableEntity(
      "Attach indexing evidence to an approved audit page",
    );
  return selected;
}

/** Caller assertions only narrow an assigned Task. They never choose a Google account or a URL. */
export async function requireSeoTaskIndexingContext(
  auth: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
  tx: Prisma.TransactionClient,
  auditPageUrlHint?: string,
) {
  const { actor, analysis, pageUrls } = await requireSeoTaskAuditContext(
    auth,
    taskId,
    expected,
    tx,
  );

  const auditPageUrl = resolveSeoIndexingAuditPageUrl(
    pageUrls,
    auditPageUrlHint,
  );
  const inspectionPageUrls = seoAuditInspectionPages(
    analysis.request,
    pageUrls,
  );

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
      auditPageUrl,
      inspectionPageUrls,
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
    auditPageUrl,
    inspectionPageUrls,
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
  auditPageUrlHint?: string,
) {
  return serializableTransaction(
    (tx) =>
      requireSeoTaskIndexingContext(
        auth,
        taskId,
        expected,
        tx,
        auditPageUrlHint,
      ),
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
