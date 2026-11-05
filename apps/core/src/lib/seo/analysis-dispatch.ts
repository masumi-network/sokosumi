import type { Prisma } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { findUsableCoworkerByCapabilityInWorkspace } from "@/helpers/access-control";
import { conflict } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type {
  RequestSeoAnalysis,
  SeoActor,
} from "@/schemas/project-seo.schema";

export function isSeoAnalysisDispatchEnabled(): boolean {
  return getEnv().SEO_ANALYSIS_DISPATCH_ENABLED === true;
}

/** Old workers treat a packet's first URL as a full audit and ignore its bounds. */
export function requireSeoAnalysisDispatch(): void {
  if (!isSeoAnalysisDispatchEnabled())
    throw conflict(
      "SEO analysis dispatch is disabled until the compatible public worker rollout is verified",
    );
}

/** Configuration names the reviewed executor; report provenance and generic Task capability do not prove protocol support. */
export async function findSeoAnalysisExecutor(
  actor: SeoActor,
  client: Prisma.TransactionClient = prisma,
) {
  const executor = getEnv().SEO_ANALYSIS_EXECUTOR;
  if (
    !isSeoAnalysisDispatchEnabled() ||
    !executor ||
    executor.workspaceId !== actor.workspaceId ||
    executor.ownerId !== actor.userId ||
    executor.organizationId !== actor.organizationId
  )
    return null;
  const usable = await findUsableCoworkerByCapabilityInWorkspace(
    executor.coworkerId,
    actor.workspaceId,
    "tasks",
    client,
  );
  return usable ? executor : null;
}

/** The normal Task/schedule assignment gate rechecks current usability inside its write transaction. */
export async function requireSeoAnalysisExecutor(
  actor: SeoActor,
  input: RequestSeoAnalysis,
  client: Prisma.TransactionClient = prisma,
) {
  const executor = await findSeoAnalysisExecutor(actor, client);
  if (!executor)
    throw conflict("The SEO check service is unavailable in this workspace");
  if (input.coworkerId && input.coworkerId !== executor.coworkerId)
    throw conflict(
      "The requested executor is not the configured SEO check service",
    );
  const usesPaidSearchData =
    input.kind === "audit_full" ||
    input.kind === "rankings" ||
    input.kind === "links" ||
    (input.kind === "audit_lite" &&
      input.analyses?.some((module) => module !== "page.inspect") === true);
  if (usesPaidSearchData && !executor.canUsePaidSearchData)
    throw conflict(
      "Paid search data is unavailable for this SEO check service",
    );
  return {
    coworkerId: executor.coworkerId,
    canSchedule: executor.canSchedule,
    analysis: {
      ...input,
      ...(!usesPaidSearchData ? { maxProviderCalls: 0 } : {}),
    },
  };
}
