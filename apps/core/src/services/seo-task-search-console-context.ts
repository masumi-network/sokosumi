import type { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { getComposio } from "@/clients/composio.client";
import { conflict, forbidden, notFound } from "@/helpers/error";
import {
  getSeoAnalysisExecution,
  isConfiguredSeoExecutor,
} from "@/lib/seo/analysis-executor-config";
import {
  type AuthenticationContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  type seoAuditSearchConsoleAccessSchema,
  storedSeoAuditSearchConsoleSchema,
} from "@/schemas/seo-task-indexing.schema";
import type { SeoTaskSearchConsoleStatus } from "@/schemas/seo-task-search-console.schema";
import { integrationFixtureMode } from "./composio-integration-tools.service";
import { canReadPrivateSeoMetrics, sha256 } from "./project-seo-store";
import {
  connectionVersion,
  lockSeoSearchConsoleIntegration,
  type SeoStatisticsIntegration,
  seoConnectionKey,
} from "./seo-connections.service";
import { requireSeoTaskAuditContext } from "./seo-task-audit-context";

type Access = z.infer<typeof seoAuditSearchConsoleAccessSchema>;
type State = Pick<SeoTaskSearchConsoleStatus, "status" | "reason"> & {
  expiresAt: string | null;
  integration: SeoStatisticsIntegration | null;
};
/** Stale-context assertions from the worker. Null on the status read, which asserts nothing. */
export interface SeoTaskSearchConsoleExpected {
  ownerId: string;
  organizationId: string | null;
}

const notConnected = (
  reason: "not_connected" | "reconnect" | "limited_audit",
): State => ({
  status: "NOT_CONNECTED",
  reason,
  expiresAt: null,
  integration: null,
});

/** Only the frozen account and property count. A newer account never serves an older audit. */
async function searchConsoleState(
  actor: SeoActor,
  access: Access | null | undefined,
  tx: Prisma.TransactionClient,
): Promise<State> {
  if (access === undefined) return notConnected("not_connected");
  if (access === null) return notConnected("limited_audit");
  if (
    !getComposio() ||
    integrationFixtureMode() ||
    !(await canReadPrivateSeoMetrics(actor, tx))
  )
    return {
      status: "UNAVAILABLE",
      reason: "unavailable",
      expiresAt: null,
      integration: null,
    };
  const current = await lockSeoSearchConsoleIntegration(actor, tx).catch(
    (error: unknown) => {
      // More than one inherited account needs an explicit native choice.
      if (error instanceof HTTPException && error.status === 409) return null;
      throw error;
    },
  );
  if (current && connectionVersion(current) === access.connectionVersion)
    return { status: "CONNECTED", expiresAt: null, integration: current };
  const key = seoConnectionKey(actor, "search_console");
  const row = await tx.seoConnection.findUnique({
    where: { workspaceId_userId_provider: key },
    select: { status: true, revision: true },
  });
  const pending =
    row &&
    (await tx.seoConnectionIntent.findFirst({
      where: {
        ...key,
        expectedRevision: row.revision,
        finalizedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true },
    }));
  if (pending)
    return {
      status: "PENDING",
      reason: "reconnect",
      expiresAt: pending.expiresAt.toISOString(),
      integration: null,
    };
  return notConnected(
    current || row?.status === "NEEDS_RECONNECT"
      ? "reconnect"
      : "not_connected",
  );
}

/**
 * Lock and recheck the configured SEO worker, the assigned Task, its approved
 * full audit and the frozen Search Console account. Caller assertions only
 * narrow the Task. They never select an owner, account or property.
 */
export async function requireSeoTaskSearchConsoleContext(
  auth: AuthenticationContext,
  taskId: string,
  expected: SeoTaskSearchConsoleExpected | null,
  tx: Prisma.TransactionClient,
) {
  const coworker = requireCoworkerAuthContext(auth);
  // Refuse every other caller before a Task row can confirm that the id exists.
  if (
    coworker.context ||
    getSeoAnalysisExecution().executor?.coworkerId !== coworker.coworkerId
  )
    throw forbidden("Only the configured SEO worker can read Search Console");
  const row = await tx.task.findUnique({
    where: { id: taskId },
    select: { ownerId: true, organizationId: true, workspaceId: true },
  });
  if (!row) throw notFound("Task not found");
  const { ownerId } = row;
  if (!ownerId) throw notFound("This Task has no approved full SEO audit");
  if (!isConfiguredSeoExecutor(coworker, { ...row, ownerId }))
    throw forbidden("Only the configured SEO worker can read Search Console");
  const context = {
    ownerId: expected ? expected.ownerId : ownerId,
    organizationId: expected ? expected.organizationId : row.organizationId,
    workspaceId: row.workspaceId,
  };
  const audit = await requireSeoTaskAuditContext(auth, taskId, context, tx);
  const { searchConsoleAccess: access } =
    storedSeoAuditSearchConsoleSchema.parse(audit.analysis.request);
  const state = await searchConsoleState(audit.actor, access, tx);
  const fingerprint = sha256(
    JSON.stringify({
      taskId,
      context,
      assigneeId: audit.task.assigneeId,
      status: audit.task.status,
      analysisId: audit.analysis.id,
      requestHash: audit.analysis.requestHash,
      request: audit.analysis.request,
      pageIds: audit.analysis.pageIds,
      state: state.status,
      connection: state.integration
        ? connectionVersion(state.integration)
        : null,
    }),
  );
  return { ...audit, context, access, ...state, fingerprint };
}

export type SeoTaskSearchConsoleContext = Awaited<
  ReturnType<typeof requireSeoTaskSearchConsoleContext>
>;

/** A read needs the exact frozen account. Every other state names its own error kind. */
export function requireConnectedSearchConsole(
  context: SeoTaskSearchConsoleContext,
) {
  if (context.status === "CONNECTED" && context.integration && context.access)
    return { integration: context.integration, access: context.access };
  if (context.status === "UNAVAILABLE")
    throw conflict("Search Console access could not be verified. Try again.", {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE,
    });
  if (context.reason === "reconnect")
    throw conflict("The audit's Search Console account is no longer current.", {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_RECONNECT,
    });
  throw conflict("This audit was not approved with Search Console.", {
    kind: CORE_API_ERROR_KINDS.SEO_GSC_NOT_CONNECTED,
  });
}
