import type { Prisma } from "@sokosumi/database";

import { conflict, unprocessableEntity } from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import type { AuthenticationContext } from "@/middleware/auth";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";
import type { TaskWorkerContext } from "@/schemas/task-worker-context.schema";
import { sha256 } from "./project-seo-store";
import { seoAuditInspectionPages } from "./seo-audit-related-pages";
import {
  connectionVersion,
  latestSeoSearchConsoleProperty,
  lockSeoSearchConsoleIntegration,
} from "./seo-connections.service";
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
  const { actor, analysis, pageUrls, task } = await requireSeoTaskAuditContext(
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
    task.status === "COMPLETED",
  );

  const { searchConsoleAccess } = storedSeoAuditSearchConsoleSchema.parse(
    analysis.request,
  );
  const current =
    searchConsoleAccess === null
      ? null
      : await lockSeoSearchConsoleIntegration(actor, tx);
  const integration =
    current &&
    searchConsoleAccess &&
    connectionVersion(current) !== searchConsoleAccess.connectionVersion
      ? null
      : current;
  const selectedProperty =
    searchConsoleAccess === undefined
      ? await latestSeoSearchConsoleProperty(actor, analysis.pageIds, tx)
      : (searchConsoleAccess?.propertyId ?? null);
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
    searchConsoleAccess,
    includeDiscoverySources:
      analysis.request !== null &&
      typeof analysis.request === "object" &&
      !Array.isArray(analysis.request) &&
      analysis.request.inspectRelated === true,
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
