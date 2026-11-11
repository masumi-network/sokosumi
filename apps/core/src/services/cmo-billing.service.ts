import { CreditBucketReferenceType } from "@sokosumi/database";
import { cmoMayExecute, getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  CmoForbiddenError,
  type Cuso,
  cmoPayer,
  findCusoForBot,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  mayApproveMarketingStrategy,
} from "@/services/marketing-strategy.service";

/**
 * CMO has no billing yet: every Cuso works on his organization's credits once
 * the strategy is approved. CMO's own checkout replaces this later.
 */
export async function isCmoSubscribed(
  _cuso: Pick<Cuso, "workspaceId">,
): Promise<boolean> {
  return true;
}

/** What every hire brings his organization, so he can research and plan. */
export const CMO_STARTER_CREDITS = 10_000;

/** Names the grant after the hire's Project, so each hire gets it once. */
function starterCreditsNote(projectId: string): string {
  return `CMO.xyz starter credits (project ${projectId})`;
}

/**
 * Gives a hire's Project its starter credits, wherever the hire landed
 * (ADR 0065), once per Project. They are Project credits that never expire
 * and end with the Cuso (ADR 0067).
 */
export async function grantCmoStarterCredits(input: {
  projectId: string;
  organizationId: string;
}): Promise<void> {
  const referenceNote = starterCreditsNote(input.projectId);
  const granted = await prisma.creditBucket.findFirst({
    where: { referenceType: CreditBucketReferenceType.FREE, referenceNote },
    select: { id: true },
  });
  if (granted) return;
  const { freeCreditAdminService } = await import(
    "@/services/free-credit-admin.service"
  );
  await freeCreditAdminService.grantFreeCredits({
    target: { targetType: "organization", targetId: input.organizationId },
    projectId: input.projectId,
    credits: CMO_STARTER_CREDITS,
    ttlDays: null,
    referenceNote,
  });
}

/**
 * Approving the strategy spends the business's credits and publishes in its
 * name: the organization's owners and admins only
 * (ADR 0061). Every other member works with Cuso freely.
 */
export async function requireCmoCommitter(
  userId: string,
  cuso: Pick<Cuso, "workspaceId">,
): Promise<void> {
  const { organizationId } = await cmoPayer(cuso);
  const workspace = { id: cuso.workspaceId, userId: null, organizationId };
  if (!(await mayApproveMarketingStrategy(userId, workspace))) {
    throw new CmoForbiddenError(
      "Only the organization's owners and admins approve Cuso's plan and start his month",
    );
  }
}

/**
 * Whether a CMO bot may schedule or publish. Null for bots that are not CMO
 * bots (no CMO rules apply) and when allowed: the owner approved the
 * strategy and the CMO subscription is active.
 */
export async function cmoExecutionRefusal(input: {
  sokoBotId: string;
  versionId: string | null;
}): Promise<string | null> {
  if (getSokoBotVersion(input.versionId).profile !== "cmo") return null;
  const cuso = await findCusoForBot(input.sokoBotId);
  if (!cuso) return null;
  const verdict = cmoMayExecute({
    approved: (await approvedMarketingStrategy(cuso.projectId)) !== null,
    subscribed: await isCmoSubscribed(cuso),
  });
  return verdict.ok ? null : verdict.reason;
}
